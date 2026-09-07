const assert = require('node:assert/strict');
const path = require('node:path');
const { parseConsoleSessionId, resolveDevUserData } = require('../../scripts/dev-profile-policy.cjs');

const sample = ` SESSIONNAME               USERNAME                 ID  STATE   TYPE        DEVICE\r\n services                                            0  Disc\r\n>console                   Administrator             1  Active`;
assert.equal(parseConsoleSessionId(sample), 1);
assert.equal(parseConsoleSessionId(' services 0 Disc'), null);

const base = 'C:\\Users\\Test\\AppData\\Roaming';
assert.equal(resolveDevUserData({ platform:'win32', sessionId:0, consoleSessionId:1, appDataRoot:base, fallbackRoot:'x' }), path.join(base, 'new-eden-sage-dev-session-0'));
assert.equal(resolveDevUserData({ platform:'win32', sessionId:1, consoleSessionId:1, appDataRoot:base, fallbackRoot:'x' }), path.join(base, 'new-eden-sage-dev-session-1'));
assert.equal(resolveDevUserData({ platform:'win32', sessionId:2, consoleSessionId:1, appDataRoot:base, fallbackRoot:'x' }), path.join(base, 'new-eden-sage-dev-session-2'));
assert.equal(resolveDevUserData({ platform:'win32', sessionId:1, consoleSessionId:null, appDataRoot:base, fallbackRoot:'x' }), path.join(base, 'new-eden-sage-dev-session-1'));
assert.equal(resolveDevUserData({ platform:'win32', sessionId:1, consoleSessionId:null, interactiveDesktop:true, appDataRoot:base, fallbackRoot:'x' }), path.join(base, 'new-eden-sage-dev-session-1'));
assert.equal(resolveDevUserData({ platform:'win32', sessionId:2, consoleSessionId:1, interactiveDesktop:true, appDataRoot:base, fallbackRoot:'x' }), path.join(base, 'new-eden-sage-dev-session-2'));
assert.equal(resolveDevUserData({ platform:'linux', sessionId:null, consoleSessionId:null, appDataRoot:'/tmp', fallbackRoot:'/repo' }), path.join('/tmp', 'new-eden-sage-dev'));
console.log('dev profile policy regression: PASS');
