import dotenv from "dotenv"; import path from "node:path"; import { fileURLToPath } from "node:url";
const d=path.dirname(fileURLToPath(import.meta.url));dotenv.config({path:path.join(d,".env")});
const B=(process.env.COOLIFY_BASE_URL||"").replace(/\/$/,"");const T=process.env.COOLIFY_API_TOKEN;const H={Authorization:`Bearer ${T}`};
const U="ris2ictgjs0f06lnrewmuukh";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const r=await(await fetch(`${B}/api/v1/deploy?uuid=${U}&force=true`,{method:"POST",headers:H})).json();
const dep=r.deployments?.[0]?.deployment_uuid;
console.log("deploy queued:", dep);
let last="";
for(let i=0;i<30;i++){
  await sleep(10000);
  const dl=await(await fetch(`${B}/api/v1/deployments/${dep}`,{headers:H})).json().catch(()=>null);
  const status=dl?.status;
  let lines=[];
  try{const p=JSON.parse(dl?.logs||"[]");lines=p.map(x=>x.output||x.line||"").filter(Boolean);}catch{lines=String(dl?.logs||"").split("\n").filter(Boolean);}
  last=lines.slice(-6).join("\n");
  console.log(`[${(i+1)*10}s] status=${status} | lines=${lines.length}`);
  if(["finished","failed","error","cancelled"].includes(status)){
    console.log("\n=== FINAL status:",status,"===");
    console.log(lines.slice(-45).join("\n"));
    break;
  }
}
