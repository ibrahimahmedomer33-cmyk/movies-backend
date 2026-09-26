import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname,'data');
fs.mkdirSync(DATA,{recursive:true});
const moviesFile = path.join(DATA,'movies.json');
const settingsFile = path.join(DATA,'settings.json');
const defaultSettings = {
  guestLimit:10,
  adsEnabled:true,
  premiumEmails:['ibrahimahmedomer99@gmail.com','ibrahimahmedomer33@gmail.com'],
  developerEmails:['ibrahimahmedomer99@gmail.com','ibrahimahmedomer33@gmail.com']
};
if(!fs.existsSync(moviesFile)) fs.writeFileSync(moviesFile,'[]');
if(!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile,JSON.stringify(defaultSettings,null,2));
const read=(f, fallback)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return fallback;}};
const write=(f,v)=>fs.writeFileSync(f,JSON.stringify(v,null,2));
const app=express();
app.use(cors()); app.use(express.json({limit:'2mb'}));
const secret=process.env.JWT_SECRET || 'CHANGE_THIS_SECRET';
const adminPassword=process.env.ADMIN_PASSWORD || 'CHANGE_THIS_ADMIN_PASSWORD';
const devEmails=new Set(defaultSettings.developerEmails.map(x=>x.toLowerCase()));
function auth(req,res,next){
  const h=req.headers.authorization||'';
  if(!h.startsWith('Bearer ')) return res.status(401).json({error:'غير مصرح'});
  try{req.admin=jwt.verify(h.slice(7),secret); if(!devEmails.has(req.admin.email)) throw new Error(); next();}
  catch{return res.status(401).json({error:'جلسة الإدارة غير صالحة'});}
}
app.get('/api/health',(req,res)=>res.json({ok:true,name:'Movies Night Backend'}));
app.get('/api/movies',(req,res)=>res.json({movies:read(moviesFile,[])}));
app.get('/api/settings',(req,res)=>res.json(read(settingsFile,defaultSettings)));
app.get('/api/tmdb/search',auth,async (req,res)=>{
  const q=String(req.query.query||'').trim();
  if(!q) return res.status(400).json({error:'اكتب اسم المحتوى'});
  const key=process.env.TMDB_API_KEY;
  if(!key) return res.status(503).json({error:'TMDB_API_KEY غير مضبوط في السيرفر'});
  try{
    const url=`https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(key)}&language=ar&query=${encodeURIComponent(q)}&include_adult=false`;
    const rr=await fetch(url);
    if(!rr.ok) throw new Error(`TMDB ${rr.status}`);
    const data=await rr.json();
    const results=(data.results||[]).filter(x=>x.media_type==='movie'||x.media_type==='tv').slice(0,10).map(x=>({
      tmdbId:x.id,
      type:x.media_type==='tv'?'series':'movie',
      title:x.title||x.name||'',
      year:(x.release_date||x.first_air_date||'').slice(0,4),
      img:x.poster_path?`https://image.tmdb.org/t/p/w780${x.poster_path}`:'',
      desc:x.overview||'',
      rating:x.vote_average?Number(x.vote_average.toFixed(1)):0,
      genreIds:x.genre_ids||[]
    }));
    // If the first result has a poster/metadata, enrich it with full details and Arabic genre names.
    if(results[0]){
      const detailUrl=`https://api.themoviedb.org/3/${results[0].type==='series'?'tv':'movie'}/${results[0].tmdbId}?api_key=${encodeURIComponent(key)}&language=ar`;
      const dr=await fetch(detailUrl);
      if(dr.ok){
        const d=await dr.json();
        results[0].genre=(d.genres||[]).map(g=>g.name);
        results[0].desc=d.overview||results[0].desc;
        results[0].img=d.poster_path?`https://image.tmdb.org/t/p/w780${d.poster_path}`:results[0].img;
        results[0].year=(d.release_date||d.first_air_date||results[0].year||'').slice(0,4);
        results[0].rating=d.vote_average?Number(d.vote_average.toFixed(1)):results[0].rating;
      }
    }
    res.json({results});
  }catch(e){res.status(502).json({error:'تعذر الاتصال بـ TMDB'});}
});

app.post('/api/admin/login',(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase();
  const password=String(req.body.password||'');
  if(!devEmails.has(email) || password!==adminPassword) return res.status(401).json({error:'بيانات دخول الإدارة غير صحيحة'});
  const token=jwt.sign({email,role:'developer',premium:true},secret,{expiresIn:'7d'});
  res.json({token,user:{email,role:'developer',premium:true}});
});
app.post('/api/movies',auth,(req,res)=>{
  const m=req.body||{}; if(!m.title||!m.type) return res.status(400).json({error:'الاسم والنوع مطلوبان'});
  const movies=read(moviesFile,[]); const item={...m,id:m.id||`mn_${Date.now()}`,year:Number(m.year)||new Date().getFullYear(),rating:Number(m.rating)||0,genre:Array.isArray(m.genre)?m.genre:[]};
  movies.unshift(item); write(moviesFile,movies); res.status(201).json(item);
});
app.put('/api/movies/:id',auth,(req,res)=>{
  const movies=read(moviesFile,[]); const i=movies.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:'غير موجود'});
  movies[i]={...movies[i],...req.body,id:movies[i].id}; write(moviesFile,movies); res.json(movies[i]);
});
app.delete('/api/movies/:id',auth,(req,res)=>{const movies=read(moviesFile,[]).filter(x=>x.id!==req.params.id);write(moviesFile,movies);res.json({ok:true});});
app.put('/api/settings',auth,(req,res)=>{const old=read(settingsFile,defaultSettings);const next={...old,...req.body};write(settingsFile,next);res.json(next);});
app.listen(process.env.PORT||3000,()=>console.log('Movies Night backend running'));
