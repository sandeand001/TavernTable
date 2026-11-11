/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import config from '../../../src/config/FirebaseConfig.json';

const root = path.resolve(__dirname, '..', '..', '..');

test('Firebase web settings contain only the public configuration for the selected project', () => {
  expect(Object.keys(config).sort()).toEqual(
    ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'].sort()
  );
  expect(config.projectId).toBe('taverntable-489d5');
  expect(config.authDomain).toBe(`${config.projectId}.firebaseapp.com`);
  expect(config.storageBucket).toBe(`${config.projectId}.firebasestorage.app`);
  expect(config.appId).toMatch(new RegExp(`^1:${config.messagingSenderId}:web:[a-f0-9]+$`));
});

test('Firebase deployment selects the approved Oregon database and explicit private rules', () => {
  const project = JSON.parse(fs.readFileSync(path.join(root, '.firebaserc'), 'utf8'));
  const deployment = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
  expect(project.projects.default).toBe(config.projectId);
  expect(deployment.firestore.database).toBe('(default)');
  expect(deployment.firestore.location).toBe('us-west1');
  for (const resource of [deployment.firestore, deployment.storage]) {
    const rules = fs.readFileSync(path.join(root, resource.rules), 'utf8');
    expect(rules).toContain('allow read, write: if false;');
    expect(rules).not.toContain('if true');
  }
});
