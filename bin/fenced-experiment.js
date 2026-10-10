import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runFencedMatrix} from '../src/fenced-experiment.js';

const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output'){console.error('usage: node bin/fenced-experiment.js --output <new-file>');process.exit(2);}
const directory=await mkdtemp(join(tmpdir(),'fenced-recovery-'));
try{const result=await runFencedMatrix(directory);await writeFile(args[1],JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
finally{const {rm}=await import('node:fs/promises');await rm(directory,{recursive:true,force:true});}
