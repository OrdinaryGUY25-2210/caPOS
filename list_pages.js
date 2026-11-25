const fs = require('fs');
const p = require('path');
function w(d){
  try{
    for(const e of fs.readdirSync(d)){
      const f = p.join(d,e);
      try{
        const s = fs.statSync(f);
        if(s.isDirectory()){
          if(e === 'node_modules' || e === '.next') continue;
          w(f);
        }else if(e === 'page.tsx'){
          if(f.indexOf('job-agent') === -1){
            console.log(f.replace(/\\/g,'/'));
          }
        }
      }catch(ex){}
    }
  }catch(ex){}
}
w('.'); 
