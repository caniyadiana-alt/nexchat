const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {
  status, headers: {"content-type":"application/json; charset=utf-8", "cache-control":"no-store", ...headers}
});
const now = () => Date.now();
const id = () => crypto.randomUUID();
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
async function sha(s){ return hex(await crypto.subtle.digest("SHA-256",enc.encode(s))); }
async function derive(password,salt){
  const key = await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode(salt),iterations:100000,hash:"SHA-256"},key,256));
}
function cookie(req,name){
  const raw=req.headers.get("Cookie")||"";
  const part=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));
  return part ? decodeURIComponent(part.slice(name.length+1)) : null;
}
async function auth(req,env){
  const token=cookie(req,"nexchat_session");
  if(!token) return null;
  const hash=await sha(token);
  const row=await env.DB.prepare("SELECT users.id,users.name,users.email,users.avatar,users.bio FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?").bind(hash,now()).first();
  return row||null;
}
function sessionCookie(token, maxAge=60*60*24*14){
  return `nexchat_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
async function requireUser(req,env){
  const user=await auth(req,env);
  return user;
}
async function member(env,conversationId,userId){
  return await env.DB.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").bind(conversationId,userId).first();
}
async function handle(req,env){
  const url=new URL(req.url), p=url.pathname, method=req.method;
  if(p==="/api/health") return json({ok:true,app:"NEXCHAT"});
  if(p==="/api/register" && method==="POST"){
    const b=await req.json().catch(()=>({}));
    const name=String(b.name||"").trim().slice(0,48), email=String(b.email||"").trim().toLowerCase(), password=String(b.password||"");
    if(name.length<2||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8) return json({error:"Isi nama, email valid, dan password minimal 8 karakter."},400);
    const salt=crypto.randomUUID()+crypto.randomUUID(), hash=await derive(password,salt), userId=id(), token=crypto.randomUUID()+crypto.randomUUID(), t=now();
    try{
      await env.DB.prepare("INSERT INTO users(id,name,email,password_hash,salt,created_at) VALUES(?,?,?,?,?,?)").bind(userId,name,email,hash,salt,t).run();
      await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(await sha(token),userId,t+14*86400000,t).run();
      return json({user:{id:userId,name,email}},201,{"set-cookie":sessionCookie(token)});
    }catch(e){return json({error:"Email sudah terdaftar atau pendaftaran gagal."},409);}
  }
  if(p==="/api/login" && method==="POST"){
    const b=await req.json().catch(()=>({})), email=String(b.email||"").trim().toLowerCase(), password=String(b.password||"");
    const u=await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
    if(!u || await derive(password,u.salt)!==u.password_hash) return json({error:"Email atau password salah."},401);
    const token=crypto.randomUUID()+crypto.randomUUID(), t=now();
    await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(await sha(token),u.id,t+14*86400000,t).run();
    return json({user:{id:u.id,name:u.name,email:u.email}},200,{"set-cookie":sessionCookie(token)});
  }
  if(p==="/api/logout" && method==="POST"){
    const token=cookie(req,"nexchat_session");
    if(token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha(token)).run();
    return json({ok:true},200,{"set-cookie":sessionCookie("",0)});
  }
  const user=await requireUser(req,env);
  if(!user) return json({error:"Silakan login terlebih dahulu."},401);
  if(p==="/api/me" && method==="GET") return json({user});
  if(p==="/api/me" && method==="PATCH"){
    const b=await req.json().catch(()=>({})), name=String(b.name||user.name).trim().slice(0,48), bio=String(b.bio||"").slice(0,160);
    await env.DB.prepare("UPDATE users SET name=?,bio=? WHERE id=?").bind(name,bio,user.id).run();
    return json({user:{...user,name,bio}});
  }
  if(p==="/api/users" && method==="GET"){
    const q=(url.searchParams.get("q")||"").trim().slice(0,48);
    if(q.length<2) return json({users:[]});
    const rows=await env.DB.prepare("SELECT id,name,email,avatar,bio FROM users WHERE id<>? AND (name LIKE ? OR email LIKE ?) ORDER BY name LIMIT 20").bind(user.id,`%${q}%`,`%${q}%`).all();
    return json({users:rows.results||[]});
  }
  if(p==="/api/conversations" && method==="GET"){
    const rows=await env.DB.prepare(`
      SELECT c.id,c.type,c.title,c.created_at,
      (SELECT m.body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) last_message,
      (SELECT m.created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) last_time
      FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id
      WHERE cm.user_id=? ORDER BY COALESCE(last_time,c.created_at) DESC
    `).bind(user.id).all();
    const out=[];
    for(const c of (rows.results||[])){
      const members=await env.DB.prepare("SELECT u.id,u.name,u.email,u.avatar FROM conversation_members cm JOIN users u ON u.id=cm.user_id WHERE cm.conversation_id=?").bind(c.id).all();
      const others=(members.results||[]).filter(x=>x.id!==user.id);
      out.push({...c,members:members.results||[],display_name:c.type==="group"?c.title:(others[0]?.name||"Percakapan")});
    }
    return json({conversations:out});
  }
  if(p==="/api/conversations/direct" && method==="POST"){
    const b=await req.json().catch(()=>({})), other=String(b.userId||"");
    if(!other||other===user.id) return json({error:"Pilih pengguna yang valid."},400);
    const exists=await env.DB.prepare("SELECT c.id FROM conversations c JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=? JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=? WHERE c.type='direct' LIMIT 1").bind(user.id,other).first();
    if(exists) return json({id:exists.id});
    const target=await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(other).first();
    if(!target) return json({error:"Pengguna tidak ditemukan."},404);
    const cid=id(), t=now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO conversations(id,type,created_by,created_at) VALUES(?,'direct',?,?)").bind(cid,user.id,t),
      env.DB.prepare("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES(?,?,'member',?)").bind(cid,user.id,t),
      env.DB.prepare("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES(?,?,'member',?)").bind(cid,other,t)
    ]);
    return json({id:cid},201);
  }
  if(p==="/api/conversations/group" && method==="POST"){
    const b=await req.json().catch(()=>({})), title=String(b.title||"").trim().slice(0,64), ids=[...new Set([user.id,...(Array.isArray(b.userIds)?b.userIds.map(String):[])])];
    if(title.length<2||ids.length<2||ids.length>50) return json({error:"Nama grup minimal 2 karakter dan pilih minimal satu anggota."},400);
    const found=await env.DB.prepare(`SELECT id FROM users WHERE id IN (${ids.map(()=>"?").join(",")})`).bind(...ids).all();
    if((found.results||[]).length!==ids.length) return json({error:"Ada anggota yang tidak ditemukan."},400);
    const cid=id(),t=now(), stmts=[env.DB.prepare("INSERT INTO conversations(id,type,title,created_by,created_at) VALUES(?,'group',?,?,?)").bind(cid,title,user.id,t)];
    for(const uid of ids) stmts.push(env.DB.prepare("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES(?,?,?,?)").bind(cid,uid,uid===user.id?"owner":"member",t));
    await env.DB.batch(stmts); return json({id:cid},201);
  }
  const cm=p.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if(cm){
    const cid=cm[1];
    if(!await member(env,cid,user.id)) return json({error:"Anda tidak memiliki akses ke percakapan ini."},403);
    if(method==="GET"){
      const before=Number(url.searchParams.get("before")||Number.MAX_SAFE_INTEGER);
      const rows=await env.DB.prepare("SELECT m.id,m.body,m.kind,m.created_at,m.sender_id,u.name sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? AND m.created_at<? ORDER BY m.created_at DESC LIMIT 100").bind(cid,before).all();
      return json({messages:(rows.results||[]).reverse()});
    }
    if(method==="POST"){
      const b=await req.json().catch(()=>({})), body=String(b.body||"").trim();
      if(!body||body.length>4000) return json({error:"Pesan harus berisi 1–4000 karakter."},400);
      const mid=id(),t=now();
      await env.DB.prepare("INSERT INTO messages(id,conversation_id,sender_id,body,kind,created_at) VALUES(?,?,?,?,'text',?)").bind(mid,cid,user.id,body,t).run();
      return json({message:{id:mid,body,kind:"text",created_at:t,sender_id:user.id,sender_name:user.name}},201);
    }
  }
  if(p==="/api/conversations" && method==="POST") return json({error:"Gunakan endpoint direct atau group."},400);
  return json({error:"Endpoint tidak ditemukan."},404);
}


export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Paksa halaman utama membuka index.html
    if (url.pathname === "/") {
      url.pathname = "/index.html";
      return env.ASSETS.fetch(
        new Request(url, req)
      );
    }

    // API tetap menggunakan backend yang sudah ada
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handle(req, env);
      } catch (e) {
        console.error("NEXCHAT_SERVER_ERROR:", e?.stack || e);
        return json(
          { error: "Terjadi kesalahan server." },
          500
        );
      }
    }

    return env.ASSETS.fetch(req);
  }
};
