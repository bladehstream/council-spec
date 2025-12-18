import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const projectId = process.argv[2] || `project-${Date.now()}`;

// Ensure directories exist
const stateDir = join(ROOT, 'state');
const convDir = join(ROOT, 'state', 'conversations');
if (!existsSync(stateDir)) {
  mkdirSync(stateDir, { recursive: true });
}
if (!existsSync(convDir)) {
  mkdirSync(convDir, { recursive: true });
}

// Clean state for new project (but preserve conversations)
const files = ['interview-output.json', 'council-output.json', 'spec-final.json'];
for (const file of files) {
  const path = join(stateDir, file);
  if (existsSync(path)) {
    console.log(`Removing existing ${file}`);
    unlinkSync(path);
  }
}

// Create new conversation log
const now = new Date();
const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
const logFilename = `${timestamp}_${projectId}.log`;
const logPath = join(convDir, logFilename);

const header = `================================================================================
SPEC WORKFLOW LOG
Project: ${projectId}
Started: ${now.toISOString()}
================================================================================

`;

writeFileSync(logPath, header);

console.log(`Initialized project: ${projectId}`);
console.log(`Conversation log: state/conversations/${logFilename}`);
console.log('Ready for interview phase.');
