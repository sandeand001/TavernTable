import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as three from 'three';
import { loadD20Model } from '../helpers/d20-model.js';
import { resolveUpFacingFace } from '../../src/systems/dice/DiceState.js';
import { rollDiceExpression } from '../../src/systems/dice/dice.js';

test('the trusted d20 returns its actual settled asset face and real physical trajectory', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const program = `
    const {PhysicalDice}=require(process.argv[1]);
    let seed=42;
    const dice=new PhysicalDice({root:process.argv[2],random:()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}});
    dice.d20({metrics:{cols:25,rows:25,tileSize:1},groundHeights:Array.from({length:25},()=>Array(25).fill(0)),obstacles:[]})
      .then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['-e', program, path.join(root, 'tools', 'physical-dice.js'), root],
    { cwd: root, timeout: 20000, maxBuffer: 2000000 }
  );
  const rolled = JSON.parse(stdout);
  expect(rolled).toMatchObject({ version: 1, type: 'physical-d20', cocked: false });
  expect(rolled.value).toBeGreaterThanOrEqual(1);
  expect(rolled.value).toBeLessThanOrEqual(20);
  expect(rolled.frames.length).toBeGreaterThan(20);
  const mesh = loadD20Model();
  const last = rolled.frames.at(-1);
  mesh.position.set(last.position.x, last.position.y, last.position.z);
  mesh.quaternion.set(last.quaternion.x, last.quaternion.y, last.quaternion.z, last.quaternion.w);
  mesh.scale.setScalar(rolled.scale);
  mesh.updateMatrixWorld(true);
  expect(resolveUpFacingFace(mesh, three).value).toBe(rolled.value);
  expect(rolled.frames[0].position).not.toEqual(last.position);
}, 30000);

test('host all-d20 mode uses every supplied physical face in a multiple-d20 expression, never digital randomness', async () => {
  const faces = [4, 18];
  const roll = await rollDiceExpression(
    { expression: '2d20+3', label: 'Physical pool' },
    {
      physicalAllD20: true,
      physicalRoll: async () => ({ success: true, value: faces.shift() }),
      random: () => {
        throw new Error('A physical d20 must not use digital randomness');
      },
    }
  );
  expect(roll).toMatchObject({
    expression: '2d20+3',
    physical: true,
    values: [4, 18],
    total: 25,
    summary: { total: 25 },
  });
  expect(roll.summary.breakdown).toContain('2d20 [4, 18]');
  expect(faces).toEqual([]);
});

test.each([
  ['advantage', 23],
  ['disadvantage', 9],
])(
  'host %s keeps the correct real face and never labels its result digital',
  async (mode, total) => {
    const faces = [4, 18];
    const roll = await rollDiceExpression(
      { expression: '1d20+5', label: 'Physical check', mode },
      {
        physicalAllD20: true,
        physicalRoll: async () => ({ success: true, value: faces.shift() }),
        random: () => {
          throw new Error('A physical check must not use digital randomness');
        },
      }
    );
    expect(roll).toMatchObject({ physical: true, values: [4, 18], total, mode });
    expect(roll.text).not.toMatch(/digital/i);
    expect(roll.summary.breakdown).toContain(`keep ${total - 5}`);
  }
);

test.each(['no-manager', 'no-window', 'cocked'])(
  'host physical dice refusal %s never substitutes a digital d20',
  async (reason) => {
    let digitalCalls = 0;
    await expect(
      rollDiceExpression(
        { expression: '2d20' },
        {
          physicalAllD20: true,
          physicalRoll: async () => ({ reason }),
          random: () => {
            digitalCalls++;
            return 0.5;
          },
        }
      )
    ).rejects.toThrow(/physical d20|cocked/);
    expect(digitalCalls).toBe(0);
  }
);
