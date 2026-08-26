// Imported for its side effect as the FIRST import in main.ts: reflect-metadata
// before any decorator runs, env before any module reads it at import time.
import 'reflect-metadata';

import dotenv from 'dotenv';
import * as path from 'node:path';

const root = (file: string) => path.resolve(__dirname, '../../../', file);

// Loaded first, so its keys win: dotenv never overwrites one already set. A
// variable given on the command line still beats both, for the same reason.
if (process.env.ENV_FILE)
    dotenv.config({ path: root(process.env.ENV_FILE) });

dotenv.config({ path: root('.env') });
