const T=process.env.DD;const H={Authorization:`Bearer ${T}`};
for(let i=0;i<6;i++){
  const me=await fetch("https://app.debutdepoly.com/api/me",{headers:H});
  const bl=await fetch("https://app.debutdepoly.com/api/services/ris2ictgjs0f06lnrewmuukh/build-logs",{headers:H});
  console.log(`try${i+1}: /me=${me.status} /build-logs=${bl.status}`);
}
