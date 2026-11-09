import path from 'node:path';
import {createReview} from './lib/review.mjs';
const args = process.argv.slice(2), at = args.indexOf('--prepared');
try {
  if (at < 0 || !args[at + 1]) throw Error('需要 --prepared 已整理的 prepared.json');
  console.log(JSON.stringify(await createReview(path.resolve(args[at + 1]))));
} catch (error) {console.error(JSON.stringify({status: 'stopped', message: error.message, ...(error.details ? {details: error.details} : {})})); process.exitCode = 1;}
