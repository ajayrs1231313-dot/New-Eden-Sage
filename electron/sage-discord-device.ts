import { USER_DATA_ROOT } from "./data-paths";
import { app, safeStorage } from "electron";
import { createHash, generateKeyPairSync, randomBytes, sign as nodeSign } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

type DiscordDeviceFile={
  deviceId:string;
  publicKeySpkiB64:string;
  fingerprintSha256:string;
  encryptedPrivateKeyPem:string;
  createdAt:string;
};

function devicePath(){return path.join(USER_DATA_ROOT,"discord-device.json");}
function nonce(){return randomBytes(24).toString("base64url");}

async function readDevice():Promise<DiscordDeviceFile|null>{
  try{
    const parsed=JSON.parse(await fs.readFile(devicePath(),"utf8")) as Partial<DiscordDeviceFile>;
    if(typeof parsed.deviceId!=="string"||typeof parsed.publicKeySpkiB64!=="string"||typeof parsed.fingerprintSha256!=="string"||typeof parsed.encryptedPrivateKeyPem!=="string")return null;
    return parsed as DiscordDeviceFile;
  }catch{return null;}
}

async function createDevice():Promise<DiscordDeviceFile>{
  if(!safeStorage.isEncryptionAvailable())throw new Error("Windows secure storage is required for Sage Discord command signing.");
  const pair=generateKeyPairSync("ec",{
    namedCurve:"prime256v1",
    publicKeyEncoding:{type:"spki",format:"der"},
    privateKeyEncoding:{type:"pkcs8",format:"pem"},
  });
  const publicKey=Buffer.from(pair.publicKey);
  const value:DiscordDeviceFile={
    deviceId:`dev_${crypto.randomUUID()}`,
    publicKeySpkiB64:publicKey.toString("base64"),
    fingerprintSha256:createHash("sha256").update(publicKey).digest("hex"),
    encryptedPrivateKeyPem:safeStorage.encryptString(String(pair.privateKey)).toString("base64"),
    createdAt:new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(devicePath()),{recursive:true});
  await fs.writeFile(devicePath(),JSON.stringify(value,null,2),{encoding:"utf8",mode:0o600});
  return value;
}

async function material(){return await readDevice()??await createDevice();}
function privateKeyPem(value:DiscordDeviceFile){
  if(!safeStorage.isEncryptionAvailable())throw new Error("Windows secure storage is required for Sage Discord command signing.");
  return safeStorage.decryptString(Buffer.from(value.encryptedPrivateKeyPem,"base64"));
}
function sign(value:DiscordDeviceFile,canonical:string){
  return nodeSign("sha256",Buffer.from(canonical,"utf8"),{key:privateKeyPem(value),dsaEncoding:"ieee-p1363"}).toString("base64");
}

export async function createDiscordDeviceRegistrationProof(){
  const value=await material();
  const timestampMs=Date.now();
  const requestNonce=nonce();
  const canonical=`NES-DISCORD-DEVICE-V1\n${value.deviceId}\n${timestampMs}\n${requestNonce}\n${value.fingerprintSha256}`;
  return {
    device_id:value.deviceId,
    public_key_spki_b64:value.publicKeySpkiB64,
    fingerprint_sha256:value.fingerprintSha256,
    platform:`electron-${process.platform}`,
    label:"New Eden Sage Desktop",
    timestamp_ms:timestampMs,
    nonce:requestNonce,
    signature_b64:sign(value,canonical),
  };
}

export async function createDiscordActionProof(workspaceId:string,characterId:number,action:string,payloadHash:string){
  const value=await material();
  const timestampMs=Date.now();
  const requestNonce=nonce();
  const canonical=`NES-DISCORD-ACTION-V1\n${workspaceId}\n${characterId}\n${action}\n${payloadHash}\n${timestampMs}\n${requestNonce}`;
  return {
    deviceId:value.deviceId,
    timestampMs,
    nonce:requestNonce,
    signatureB64:sign(value,canonical),
  };
}
