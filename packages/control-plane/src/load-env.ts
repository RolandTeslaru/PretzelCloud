// Imported for its side effect as the FIRST import in main.ts: reflect-metadata
// before any decorator runs, env before any module reads it at import time.
import 'reflect-metadata';

import dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
