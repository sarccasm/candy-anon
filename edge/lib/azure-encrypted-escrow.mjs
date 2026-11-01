import { createHash } from 'node:crypto';
import { validToken, validCiphertext } from './encrypted-fulfillment.mjs';

// Container MUST be private. This adapter performs no plaintext handling.
// Azure Blob Storage's conditional writes prevent overwriting an existing payload.
export class DurableEncryptedEscrow {
  constructor(container) {
    if (!container?.getBlockBlobClient) throw new Error('invalid_blob_container');
    this.container = container;
  }
  blob(token) {
    if (!validToken(token)) throw new Error('invalid_token');
    return this.container.getBlockBlobClient(token + '.asc');
  }
  async save(token, encrypted) {
    if (!validCiphertext(encrypted)) throw new Error('invalid_encrypted_payload');
    const client=this.blob(token);
    const bytes=Buffer.from(encrypted,'utf8');
    const checksum=createHash('sha256').update(bytes).digest('hex');
    try {
      await client.uploadData(bytes,{conditions:{ifNoneMatch:'*'},
        blobHTTPHeaders:{blobContentType:'application/pgp-encrypted'},
        metadata:{sha256:checksum}});
      return {created:true};
    } catch(e) {
      if (![409,412].includes(e.statusCode)) throw e;
      const props=await client.getProperties();
      if(props.metadata?.sha256 !== checksum) throw new Error('encrypted_payload_conflict');
      return {created:false};
    }
  }
  async exists(token) {
    const client=this.blob(token);
    try { return await client.exists(); }
    catch(e){ if(e.statusCode===404)return false;throw e; }
  }
  async read(token) {
    const client=this.blob(token);
    try {
      const download=await client.download();
      const chunks=[];
      for await (const part of download.readableStreamBody) chunks.push(part);
      const data=Buffer.concat(chunks).toString('utf8');
      if(!validCiphertext(data)) throw new Error('corrupt_ciphertext');
      return data;
    } catch(e) { if(e.statusCode===404)return null;throw e; }
  }
  async deleteAfterAcknowledgment(token,{carrierAcknowledged=false,retentionElapsed=false}={}) {
    if(!carrierAcknowledged||!retentionElapsed) return false;
    const client=this.blob(token);
    const props=await client.getProperties();
    try {
      await client.delete({conditions:{ifMatch:props.etag}});
      return true;
    } catch(e) {if(e.statusCode===412||e.statusCode===409)return false;throw e;}
  }
}

let cached;
export async function azureEscrowFromEnvironment() {
  if(cached)return cached;
  const connection=process.env.AZURE_STORAGE_CONNECTION_STRING;
  const name=process.env.ENCRYPTED_ESCROW_CONTAINER;
  if(!connection||!name||!/^[a-z0-9-]{3,63}$/.test(name))throw new Error('escrow_not_configured');
  const {BlobServiceClient}=await import('@azure/storage-blob');
  const container=BlobServiceClient.fromConnectionString(connection).getContainerClient(name);
  // Provision a private container before deployment; never create a public one here.
  cached=new DurableEncryptedEscrow(container);
  return cached;
}
