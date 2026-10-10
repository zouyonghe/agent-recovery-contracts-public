import {startTool} from '../src/tool.js';

const [file,mode='none']=process.argv.slice(2);
if(!file||!['none','response_lost'].includes(mode)||!process.send)throw Error('invalid fenced worker configuration');
let fences=0;
const tool=await startTool({file,fenced:true,responseFault:stage=>{
  if(stage==='fence_commit'&&mode==='response_lost'&&fences++===0)throw Error('response_lost');
}});
process.send({url:tool.url});
process.on('disconnect',()=>tool.close().then(()=>process.exit(0)));
