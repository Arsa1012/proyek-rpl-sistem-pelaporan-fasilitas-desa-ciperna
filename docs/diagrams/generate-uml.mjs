/**
 * Generator Class Diagram, Sequence Diagram, dan ERD — Desa Ciperna v1.1.
 * Berdasarkan prisma/schema.prisma & struktur kode aktual (src/lib, src/app/api).
 * Murni SVG tanpa dependensi. Jalankan: node docs/diagrams/generate-uml.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('docs/diagrams');
mkdirSync(OUT, { recursive: true });

const C = {
  ink:'#0f172a', muted:'#475569', line:'#334155', soft:'#e2e8f0',
  blue:'#dbeafe', blueB:'#3b82f6', green:'#dcfce7', greenB:'#22c55e',
  yellow:'#fef3c7', yellowB:'#f59e0b', red:'#fee2e2', redB:'#ef4444',
  violet:'#ede9fe', violetB:'#7c3aed', teal:'#ccfbf1', tealB:'#0f766e',
  white:'#ffffff', bg:'#f8fafc',
};
const F = "Inter, 'Segoe UI', Arial, sans-serif";
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function txt(x,y,s,o={}){
  const {size=12,weight=400,anchor='middle',fill=C.ink,fill0}=o;
  return `<text x="${x}" y="${y}" font-family="${F}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
}
function arrow(x1,y1,x2,y2,o={}){
  const {dashed=false,label='',color=C.line,lw=1.6,labelDy=-5}=o;
  const a=Math.atan2(y2-y1,x2-x1),len=8;
  const p1=`${x2-len*Math.cos(a-0.45)},${y2-len*Math.sin(a-0.45)}`;
  const p2=`${x2-len*Math.cos(a+0.45)},${y2-len*Math.sin(a+0.45)}`;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${lw}" ${dashed?'stroke-dasharray="6 4"':''}/>`+
    `<polygon points="${x2},${y2} ${p1} ${p2}" fill="${color}"/>`+
    (label?txt((x1+x2)/2,(y1+y2)/2+labelDy,label,{size:10,fill:C.muted,weight:600}):'');
}
function line(x1,y1,x2,y2,o={}){
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.color||C.line}" stroke-width="${o.lw||1.4}" ${o.dashed?'stroke-dasharray="5 4"':''}/>`;
}
function head(w,h,title,sub){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${C.bg}"/>
  ${txt(w/2,40,title,{size:28,weight:800})}
  ${txt(w/2,66,sub,{size:14,fill:C.muted})}`;
}
const foot=(w,h,label)=>txt(w/2,h-14,label,{size:12,fill:C.muted});

/* ====================== CLASS DIAGRAM ====================== */
function classDiagram(){
  const w=2100,h=1500;
  let s=head(w,h,'Class Diagram — Desa Ciperna','Berdasarkan model Prisma & service layer · v1.1 · reliasi 1:N / N:M ditandai dengan kardinalitas');
  // class boxes
  const box=(x,y,bw,bh,name,attrs,methods,fill,border)=>{
    let r=`<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" fill="${C.white}" stroke="${border}" stroke-width="2"/>`;
    r+=`<rect x="${x}" y="${y}" width="${bw}" height="28" rx="8" fill="${fill}"/>`;
    r+=`<rect x="${x}" y="${y+18}" width="${bw}" height="10" fill="${fill}"/>`;
    r+=txt(x+bw/2,y+19,name,{size:12.5,weight:800,fill:C.ink});
    let ay=y+42;
    for(const a of attrs){ r+=txt(x+10,ay,a,{size:10.5,anchor:'start',fill:C.ink}); ay+=21; }
    ay+=6;
    r+=line(x+8,ay-14,x+bw-8,ay-14,{color:C.soft});
    for(const m of methods||[]){ r+=txt(x+10,ay,m,{size:10.5,anchor:'start',fill:C.blueB}); ay+=21; }
    return r;
  };
  // Row 1: core
  const cUser=box(40,100,250,196,'User',['+ id: String','+ name: String','+ email: String (unique)','+ password: String (hash)','+ phone: String?','+ role: CITIZEN|ADMIN|OFFICER','+ isActive: Boolean','+ rtId: String?'],['+ reports()','+ assignments()','+ notifications()'],C.teal,C.tealB);
  const cReport=box(360,100,280,230,'Report',['+ id: String','+ userId: String (FK)','+ title, description: String','+ category, damageType: String?','+ severity: String?','+ location: String','+ latitude, longitude: Float?','+ status: ReportStatus','+ aiStatus: AiStatus','+ duplicateStatus: String'],['+ user()','+ assignments()','+ evidences()','+ histories()','+ analyses()'],C.blue,C.blueB);
  const cAssign=box(720,100,250,180,'Assignment',['+ id: String','+ reportId: String (FK)','+ officerId: String (FK)','+ assignedAt: DateTime','+ completedAt: DateTime?','+ reviewStatus: PENDING|APPROVED|REVISION','+ notifyMode: TEXT|TEXT_PHOTO'],['+ report()','+ officer()','+ evidences()'],C.yellow,C.yellowB);
  const cEvidence=box(1050,100,240,150,'ReportEvidence',['+ id: String','+ reportId: String (FK)','+ assignmentId: String? (FK)','+ photo: String','+ description: String?'],[],C.green,C.greenB);
  const cHistory=box(1370,100,250,150,'ReportStatusHistory',['+ id: String','+ reportId: String (FK)','+ status: ReportStatus','+ actorRole: String?','+ actorName: String?','+ createdAt: DateTime'],[],C.gray||C.soft,C.muted);
  const cAnalysis=box(1700,100,300,180,'ReportAnalysis',['+ id: String','+ reportId: String (FK)','+ status: SUCCESS|FAILED','+ provider, model: String?','+ category, severity: String?','+ confidence: Float?','+ summary, recommendation: String?'],['+ report()'],C.violet,C.violetB);
  s+=cUser+cReport+cAssign+cEvidence+cHistory+cAnalysis;
  // relations row1
  s+=line(290,150,360,150,{color:C.tealB,lw:2});
  s+=txt(325,142,'1',{size:10,fill:C.tealB,weight:700});
  s+=line(640,150,720,150,{color:C.blueB,lw:2});
  s+=txt(680,142,'1',{size:10,fill:C.blueB,weight:700});
  s+=line(970,150,1050,150,{color:C.yellowB,lw:2});
  s+=txt(1010,142,'1',{size:10,fill:C.yellowB,weight:700});
  s+=line(1290,150,1370,150,{color:C.greenB,lw:2});
  s+=line(1620,150,1700,150,{color:C.violetB,lw:2});

  // Row 2: portal + region
  const cProfile=box(40,400,250,170,'VillageProfile',['+ id: "singleton"','+ name, district, regency','+ province: String','+ history, vision, mission','+ dataStatus: String','+ sourceUrl: String?'],[],C.teal,C.tealB);
  const cOfficial=box(360,400,250,160,'VillageOfficial',['+ id: String','+ name, position: String','+ category: String','+ isActive, isVerified: Boolean','+ archivedAt: DateTime?'],[],C.green,C.greenB);
  const cService=box(680,400,250,150,'VillageService',['+ id: String','+ name: String','+ requirements, procedure','+ schedule, contact: String?','+ isVerified: Boolean'],[],C.blue,C.blueB);
  const cAnnon=box(1000,400,270,180,'VillageAnnouncement',['+ id: String','+ slug: String (unique)','+ title, content: String','+ isPublished: Boolean','+ target: ALL|CITIZEN|OFFICER','+ notifyWhatsApp: Boolean','+ validFrom, validUntil: DateTime?'],['+ notifications()','+ deliveries()'],C.yellow,C.yellowB);
  const cDelivery=box(1350,400,250,150,'AnnouncementDelivery',['+ id: String','+ announcementId: String (FK)','+ toMasked: String?','+ status: PENDING|SENT|FAILED','+ providerMessageId: String?'],[],C.red,C.redB);
  const cNotif=box(1680,400,270,160,'Notification',['+ id: String','+ userId: String (FK)','+ title, message: String','+ type: String','+ isRead: Boolean','+ announcementId: String? (FK)'],[],C.violet,C.violetB);
  s+=cProfile+cOfficial+cService+cAnnon+cDelivery+cNotif;
  s+=line(1270,470,1350,470,{color:C.yellowB,lw:2});
  s+=line(1600,470,1680,470,{color:C.redB,lw:2});
  s+=arrow(465,560,620,560,{dashed:true,color:C.muted,label:'Admin kelola (CRUD)'});

  // Row 3: region + auth + config
  const cRw=box(40,700,230,140,'VillageRw',['+ id: String','+ number: String (unique)','+ name: String?','+ isActive: Boolean'],['+ rts()'],C.teal,C.tealB);
  const cRt=box(340,700,230,150,'VillageRt',['+ id: String','+ rwId: String (FK)','+ number: String','+ isActive: Boolean'],['+ rw()','+ users()'],C.green,C.greenB);
  const cOtp=box(650,700,260,170,'RegistrationOtp',['+ id: String','+ email: String (unique)','+ phone: String (unique)','+ passwordHash: String','+ otpHash: String (HMAC)','+ expiresAt: DateTime','+ attempts: Int'],[],C.yellow,C.yellowB);
  const cToken=box(990,700,260,150,'AccountToken',['+ id: String','+ userId: String','+ purpose: ACTIVATION|RESET','+ tokenHash: String (unique)','+ expiresAt, usedAt: DateTime?'],[],C.red,C.redB);
  const cAudit=box(1330,700,250,150,'AdminAuditLog',['+ id: String','+ adminId: String','+ action: String','+ targetUserId: String?','+ targetReportId: String?'],[],C.soft,C.muted);
  const cKnow=box(1660,700,300,170,'AiKnowledgeEntry',['+ id: String','+ title, content: String','+ category: String','+ sourceRole: CITIZEN|ADMIN|OFFICER','+ verified: Boolean','+ isPrivate: Boolean'],[],C.violet,C.violetB);
  s+=cRw+cRt+cOtp+cToken+cAudit+cKnow;
  s+=line(270,770,340,770,{color:C.tealB,lw:2});
  s+=txt(1810,900,'dipakai AI (RAG)',{size:10,fill:C.violetB,weight:600});

  // Row 4: AI config + WA + services layer
  const cProvider=box(40,980,270,180,'AiProvider',['+ id: String','+ provider: openrouter|gemini|groq','+ apiKeyCipher: String? (AES-GCM)','+ isActive: Boolean','+ primaryModel: String?','+ fallbackModels: String? (JSON)','+ lastErrorDetail: String?'],['+ resolveChain()'],C.violet,C.violetB);
  const cPolicy=box(390,980,270,170,'AiModelPolicy',['+ id: String','+ provider, modelId: String','+ freeStatus: VERIFIED_FREE|','+   ACCOUNT_DEPENDENT|UNVERIFIED|PAID','+ evidenceUrl: String?','+ verificationSource: String?'],['+ isAllowedStatus()'],C.blue,C.blueB);
  const cFonnte=box(740,980,260,160,'FonnteConfig',['+ id: String','+ token: String (legacy)','+ tokenCipher: String? (AES-GCM)','+ adminPhone: String','+ isActive: Boolean'],[],C.yellow,C.yellowB);
  const cRecip=box(1080,980,250,150,'NotificationRecipient',['+ id: String','+ label: String','+ phone: String','+ isActive: Boolean'],[],C.green,C.greenB);
  const cWaLog=box(1410,980,250,150,'WhatsAppLog',['+ id: String','+ dedupeKey: String (unique)','+ kind: String','+ toMasked: String','+ status: SENT|FAILED'],[],C.red,C.redB);
  const cSvc=box(1740,980,260,180,'«service layer»',['+ aiChat.ts','+ aiProviders.ts','+ aiProviderConfig.ts','+ aiModelPolicy.ts','+ whatsapp.ts','+ reportAnalysis.ts','+ duplicates.ts'],[],C.teal,C.tealB);
  s+=cProvider+cPolicy+cFonnte+cRecip+cWaLog+cSvc;
  s+=line(310,1060,390,1060,{color:C.violetB,lw:2});
  // Rute dependensi service layer: turun ke bawah kotak lalu ke kiri (tidak memotong kotak)
  s+=`<path d="M1870 1160 L1870 1208 L520 1208 L520 1165" fill="none" stroke="${C.tealB}" stroke-width="1.6" stroke-dasharray="6 4"/>`;
  s+=txt(1200,1202,'service layer mengelola model & konfigurasi (aiChat, aiProviders, aiProviderConfig, whatsapp, reportAnalysis, duplicates)',{size:10,fill:C.tealB,weight:600});

  // legend
  s+=`<rect x="40" y="1230" width="2020" height="120" rx="10" fill="${C.white}" stroke="${C.soft}"/>`;
  s+=txt(60,1255,'Keterangan:',{size:13,weight:700,anchor:'start'});
  s+=txt(60,1280,'Kotak = class/model  ·  atribut dengan + = public  ·  relasi garis = asosiasi  ·  garis putus-putus = dependensi/service  ·  angka = kardinalitas (1:N)',{size:11.5,anchor:'start',fill:C.muted});
  s+=txt(60,1304,'Semua model menggunakan id: String @default(uuid()) dan createdAt/updatedAt: DateTime kecuali ditentukan lain. Password/token/API key TIDAK pernah disimpan plaintext (bcrypt / HMAC / AES-256-GCM).',{size:11.5,anchor:'start',fill:C.muted});
  s+=txt(60,1328,'SOLID: pemisahan model (schema.prisma) · service (src/lib/*.ts) · adapter provider (aiProviders.ts) · route handler (src/app/api/**).',{size:11.5,anchor:'start',fill:C.muted});
  s+=foot(w,h,'Sistem Informasi Pelayanan & Pelaporan Warga Desa Ciperna · Class Diagram v1.1');
  return s+'</svg>';
}

/* ====================== SEQUENCE DIAGRAM ====================== */
function sequenceDiagram(){
  const w=2100,h=1180;
  let s=head(w,h,'Sequence Diagram — Desa Ciperna','4 alur utama · pertukaran pesanan Frontend → Backend → Database → AI/WhatsApp API');
  const seq=(x0,y0,title,actors,steps,width)=>{
    let r=`<rect x="${x0}" y="${y0}" width="${width}" height="${h-y0-70}" rx="12" fill="${C.white}" stroke="${C.soft}"/>`;
    r+=`<rect x="${x0}" y="${y0}" width="${width}" height="34" rx="12" fill="${C.tealB}"/><rect x="${x0}" y="${y0+20}" width="${width}" height="14" fill="${C.tealB}"/>`;
    r+=txt(x0+width/2,y0+23,title,{size:13,weight:800,fill:C.white});
    const ax=[]; const span=(width-60)/actors.length;
    actors.forEach((a,i)=>{const cx=x0+30+span*(i+0.5);ax.push(cx);
      r+=`<rect x="${cx-58}" y="${y0+46}" width="116" height="34" rx="7" fill="${C.teal}" stroke="${C.tealB}"/>`;
      r+=txt(cx,y0+67,a,{size:10,weight:700});});
    let yy=y0+100;
    for(const st of steps){
      const [from,to,label,ret,dashed]=st;
      const x1=ax[from],x2=ax[to];
      r+=arrow(x1,yy,x2,yy,{label,dashed,color:C.line});
      if(ret){
        r+=`<line x1="${x2}" y1="${yy+8}" x2="${x2}" y2="${yy+26}" stroke="${C.muted}" stroke-width="1.2"/>`;
        r+=arrow(x2,yy+26,x1,yy+26,{label:ret,color:C.muted,lw:1.2,labelDy:-5});
        yy+=50;
      } else yy+=32;
      // lifeline extension drawn as faint vertical
      r+=`<line x1="${ax[0]}" y1="${yy-10}" x2="${ax[0]}" y2="${yy+4}" stroke="${C.soft}" stroke-width="1" stroke-dasharray="3 3"/>`;
    }
    return r;
  };
  // 4 sequences in 2x2
  s+=seq(30,100,['A · Registrasi + OTP WhatsApp'],['Warga','Frontend','API /api/auth','DB (RegistrationOtp)','Fonnte API'],[
    [0,1,'Isi form registrasi'],[1,2,'POST /register'],[2,3,'Simpan passwordHash + otpHash'],[2,4,'Kirim OTP via WhatsApp'],
    [4,0,'OTP diterima WA'],[0,1,'Masukkan 6 digit OTP'],[1,2,'POST /register/verify'],[2,3,'Validasi otpHash + consume'],[2,3,'Buat User (CITIZEN)'],[2,1,'201 + sesi'],[1,0,'Redirect dashboard'],
  ],1020);
  s+=seq(1080,100,['B · Buat Laporan + Analisis AI'],['Warga','Frontend','API /api/reports','DB (Report)','AI Provider'],[
    [0,1,'Isi judul, lokasi, upload foto'],[1,2,'POST /reports (+ clientKey)'],[2,3,'INSERT Report (SUBMITTED)'],[2,3,'Tulis ReportStatusHistory'],
    [2,4,'Analisis gambar + teks'],[4,2,'kategori, severity, confidence'],[2,3,'UPDATE aiResult + aiStatus'],[2,3,'Cek duplikat (Jaccard + AI)'],
    [2,1,'201 + id laporan'],[1,0,'Tampil notifikasi sukses'],
  ],1020);
  s+=seq(1100+0,620,['C · Penugasan → Verifikasi Admin'],['Admin','Frontend','API assignments','DB','Petugas + WA'],[
    [0,1,'Pilih laporan + petugas'],[1,2,'POST /assignments'],[2,3,'UPDATE status=ASSIGNED'],[2,4,'Notif WA ke petugas & warga'],
    [4,3,'PATCH mulai kerja (IN_PROGRESS)'],[4,3,'Upload bukti → REVIEW'],[2,4,'Notif WA ke Admin'],[0,2,'POST /review APPROVE'],
    [2,3,'UPDATE COMPLETED + audit log'],[2,4,'Kirim notifikasi selesai ke warga'],
  ],1020);
  s+=seq(30,620,['D · Chat Asisten AI (RAG + Fallback)'],['Pengguna','Frontend','API /ai/chat','DB knowledge','AI Provider'],[
    [0,1,'Ketik pertanyaan'],[1,2,'POST /ai/chat (+ sesi, role)'],[2,3,'Ambil AiKnowledgeEntry terverifikasi'],
    [2,3,'Ambil konteks laporan user'],[2,4,'callProvider(model utama)'],[4,2,'200 + teks / gagal'],
    [2,4,'Fallback → model cadangan (VERIFIED_FREE)'],[2,3,'Simpan riwayat chat + audit'],
    [2,1,'Jawaban + meta provider/model'],[1,0,'Tampil bubble asisten'],
  ],1020);
  return s+foot(w,h,'Sistem Informasi Pelayanan & Pelaporan Warga Desa Ciperna · Sequence Diagram v1.1')+'</svg>';
}

/* ====================== ERD ====================== */
function erd(){
  const w=2100,h=1450;
  let s=head(w,h,'ERD — Entity Relationship Diagram','Berdasarkan prisma/schema.prisma (SQLite) · PK = primary key, FK = foreign key, UQ = unique');
  const ent=(x,y,bw,name,fields,fill,border)=>{
    let r=`<rect x="${x}" y="${y}" width="${bw}" height="${fields.length*17+32}" rx="7" fill="${C.white}" stroke="${border}" stroke-width="1.8"/>`;
    r+=`<rect x="${x}" y="${y}" width="${bw}" height="26" rx="7" fill="${fill}"/><rect x="${x}" y="${y+16}" width="${bw}" height="10" fill="${fill}"/>`;
    r+=txt(x+bw/2,y+18,name,{size:11.5,weight:800});
    fields.forEach((f,i)=>{ const isPk=f.startsWith('PK'),isFk=f.includes('FK');
      r+=txt(x+8,y+42+i*17,f,{size:9.3,anchor:'start',fill:isPk?C.redB:isFk?C.blueB:C.ink,weight:isPk||isFk?700:400});
    });
    return r;
  };
  const E={};
  E.user=ent(30,100,190,'User',['PK id','email UQ','role','rtId FK','name, phone','isActive'],C.teal,C.tealB);
  E.report=ent(290,100,215,'Report',['PK id','userId FK','title, location','status, aiStatus','aiResult, confidence','duplicateStatus','clientKey UQ(userId,clientKey)'],C.blue,C.blueB);
  E.assign=ent(575,100,205,'Assignment',['PK id','reportId FK','officerId FK','assignedAt','reviewStatus','notifyMode'],C.yellow,C.yellowB);
  E.evidence=ent(850,100,205,'ReportEvidence',['PK id','reportId FK','assignmentId FK','photo','description'],C.green,C.greenB);
  E.history=ent(1125,100,205,'ReportStatusHistory',['PK id','reportId FK','status','actorRole','createdAt'],C.soft,C.muted);
  E.analysis=ent(1400,100,205,'ReportAnalysis',['PK id','reportId FK','status','provider, model','confidence','summary'],C.violet,C.violetB);
  E.notif=ent(1675,100,205,'Notification',['PK id','userId FK','title, message','type, isRead','announcementId FK UQ'],C.red,C.redB);
  for(const k in E) s+=E[k];
  // rel arrows row1
  s+=line(220,150,290,150,{color:C.tealB,lw:2}); s+=txt(255,142,'1:N',{size:9,fill:C.tealB,weight:700});
  s+=line(505,150,575,150,{color:C.blueB,lw:2}); s+=txt(540,142,'1:N',{size:9,fill:C.blueB,weight:700});
  s+=line(780,150,850,150,{color:C.yellowB,lw:2}); s+=txt(815,142,'1:N',{size:9,fill:C.yellowB,weight:700});
  s+=line(1055,150,1125,150,{color:C.greenB,lw:2});
  s+=line(1330,150,1400,150,{color:C.violetB,lw:2});

  // row2 portal
  const E2={};
  E2.profile=ent(30,430,190,'VillageProfile',['PK id "singleton"','name, district','regency, province','dataStatus','sourceUrl'],C.teal,C.tealB);
  E2.official=ent(290,430,215,'VillageOfficial',['PK id','name, position','category, level','isVerified','archivedAt'],C.green,C.greenB);
  E2.service=ent(575,430,205,'VillageService',['PK id','name','schedule, contact','isVerified'],C.blue,C.blueB);
  E2.annon=ent(850,430,205,'VillageAnnouncement',['PK id','slug UQ','title, content','isPublished','target, notifyWhatsApp'],C.yellow,C.yellowB);
  E2.delivery=ent(1125,430,205,'AnnouncementDelivery',['PK id','announcementId FK','userId','status, toMasked','UQ(announcementId,userId)'],C.red,C.redB);
  E2.audit=ent(1400,430,205,'AdminAuditLog',['PK id','adminId','action','targetUserId','targetReportId'],C.soft,C.muted);
  for(const k in E2) s+=E2[k];
  s+=line(1055,480,1125,480,{color:C.yellowB,lw:2}); s+=txt(1090,472,'1:N',{size:9,fill:C.yellowB,weight:700});

  // row3 region/auth/AI/WA
  const E3={};
  E3.rw=ent(30,760,190,'VillageRw',['PK id','number UQ','name, isActive'],C.teal,C.tealB);
  E3.rt=ent(290,760,215,'VillageRt',['PK id','rwId FK','number UQ(rwId,number)','isActive'],C.green,C.greenB);
  E3.otp=ent(575,760,205,'RegistrationOtp',['PK id','email UQ, phone UQ','passwordHash, otpHash','expiresAt, attempts'],C.yellow,C.yellowB);
  E3.token=ent(850,760,205,'AccountToken',['PK id','userId','purpose','tokenHash UQ','expiresAt, usedAt'],C.red,C.redB);
  E3.provider=ent(1125,760,205,'AiProvider',['PK id','provider UQ','apiKeyCipher','isActive, primaryModel'],C.violet,C.violetB);
  E3.policy=ent(1400,760,205,'AiModelPolicy',['PK id','provider, modelId UQ','freeStatus','evidenceUrl','verificationSource'],C.blue,C.blueB);
  E3.know=ent(1675,760,205,'AiKnowledgeEntry',['PK id','title, category','sourceRole','verified, isPrivate'],C.violet,C.violetB);
  for(const k in E3) s+=E3[k];
  s+=line(220,810,290,810,{color:C.tealB,lw:2}); s+=txt(255,802,'1:N',{size:9,fill:C.tealB,weight:700});
  s+=txt(120,985,'User.rtId → VillageRt (lihat tabel User & VillageRt)',{size:9,fill:C.muted,weight:600,anchor:'start'});
  s+=line(1330,810,1400,810,{color:C.violetB,lw:2}); s+=txt(1365,802,'1:N',{size:9,fill:C.violetB,weight:700});

  // row4 WA config
  const E4={};
  E4.fonnte=ent(30,1050,215,'FonnteConfig',['PK id','token (legacy)','tokenCipher AES-GCM','adminPhone, isActive'],C.yellow,C.yellowB);
  E4.recip=ent(320,1050,215,'NotificationRecipient',['PK id','label, phone','isActive'],C.green,C.greenB);
  E4.walog=ent(610,1050,215,'WhatsAppLog',['PK id','dedupeKey UQ','kind, toMasked','status'],C.red,C.redB);
  for(const k in E4) s+=E4[k];
  s+=`<rect x="900" y="1050" width="980" height="150" rx="10" fill="${C.white}" stroke="${C.soft}"/>`;
  s+=txt(920,1078,'Catatan relasi & integritas:',{size:13,weight:700,anchor:'start'});
  s+=txt(920,1104,'• Satu User punya banyak Report (1:N); satu Report punya banyak Assignment, Evidence, History, Analysis (1:N).',{size:11,anchor:'start',fill:C.muted});
  s+=txt(920,1126,'• Notification → VillageAnnouncement (N:1) dengan UQ(userId, announcementId) = satu notifikasi per pengumuman per user.',{size:11,anchor:'start',fill:C.muted});
  s+=txt(920,1148,'• VillageRw → VillageRt (1:N); User.rtId → VillageRt (N:1). Wilayah tidak pernah dihapus permanen (isActive=false).',{size:11,anchor:'start',fill:C.muted});
  s+=txt(920,1170,'• AiProvider → AiModelPolicy (1:N): hanya VERIFIED_FREE yang dipakai. FonnteConfig (pengirim) terpisah dari NotificationRecipient (penerima).',{size:11,anchor:'start',fill:C.muted});
  s+=txt(920,1192,'• Semua token/kata sandi/API key disimpan terenkripsi (bcrypt/HMAC-SHA256/AES-256-GCM); nomor WhatsApp hanya disimpan samaran (toMasked) di log.',{size:11,anchor:'start',fill:C.muted});
  return s+foot(w,h,'Sistem Informasi Pelayanan & Pelaporan Warga Desa Ciperna · ERD v1.1')+'</svg>';
}

writeFileSync(path.join(OUT,'class-diagram-v1.1.svg'),classDiagram(),'utf8');
writeFileSync(path.join(OUT,'sequence-diagram-v1.1.svg'),sequenceDiagram(),'utf8');
writeFileSync(path.join(OUT,'erd-v1.1.svg'),erd(),'utf8');
console.log('OK: class-diagram-v1.1.svg, sequence-diagram-v1.1.svg, erd-v1.1.svg');
