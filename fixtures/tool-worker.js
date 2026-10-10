// Test-host worker; fault configuration is deliberately outside public HTTP tools.
import {startTool} from '../src/tool.js';

const [file,mode]=process.argv.slice(2);
if(!file||!['none','before_commit','after_commit'].includes(mode)||!process.send)throw Error('invalid worker configuration');
const tool=await startTool({file,fault:call=>call===1&&mode!=='none'?mode:null});
process.send({url:tool.url});
process.on('disconnect',()=>tool.close().then(()=>process.exit(0)));
