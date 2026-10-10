import {parseArgs} from 'node:util';
import {mkdtemp,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runMatrix} from '../src/experiment.js';

let values;
try {
  ({values}=parseArgs({options:{output:{type:'string'},'durable-receipts':{type:'boolean',default:false}},allowPositionals:false}));
  if(!values.output)throw Error('--output is required');
}catch(error){console.error(error.message);process.exit(2);}

let directory,output;
try {
  // Exclusive creation rejects existing evidence before starting any tools.
  output=await open(values.output,'wx',0o600);
  directory=await mkdtemp(join(tmpdir(),'agent-recovery-matrix-'));
  const report=await runMatrix(directory,{durableReceipts:values['durable-receipts']});
  await output.writeFile(JSON.stringify(report,null,2)+'\n');
  await output.sync();
  console.log(JSON.stringify({output:values.output,protocol:report.protocol,summary:report.summary}));
}catch(error){console.error(error.message);process.exitCode=1;}
finally {
  if(output)await output.close();
  if(directory)await rm(directory,{recursive:true});
}
