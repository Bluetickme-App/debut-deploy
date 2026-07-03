import dotenv from "dotenv"; import path from "node:path"; import { fileURLToPath } from "node:url";
const d=path.dirname(fileURLToPath(import.meta.url));dotenv.config({path:path.join(d,".env")});
const B=(process.env.COOLIFY_BASE_URL||"").replace(/\/$/,"");const T=process.env.COOLIFY_API_TOKEN;const H={Authorization:`Bearer ${T}`};
const U="ajjs13qg0mtkgozlwip84cyd";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const r=await(await fetch(`${B}/api/v1/deploy?uuid=${U}&force=true`,{method:"POST",headers:H})).json();
const dep=r.deployments?.[0]?.deployment_uuid;
console.log("deploy queued:", dep);
for(let i=0;i<8;i++){
  await sleep(13000);
  const dl=await(await fetch(`${B}/api/v1/deployments/${dep}`,{headers:H})).json().catch(()=>({}));
  console.log(`[${(i+1)*13}s] status=${dl.status}`);
  if(["finished","failed","error","cancelled"].includes(dl.status)) break;
}
