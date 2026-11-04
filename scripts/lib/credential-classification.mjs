export function classifyCredential(name,value) {
 name=String(name).toUpperCase();
 const text=String(value ?? '').trim();
 if(!text||/^(change[_ -]?me|your_[a-z_]+|rpcuser|rpcpass|dev-token|passphrase_here)$/i.test(text)||
   (text.includes('BEGIN PGP PRIVATE KEY')&&text.includes('...')))return 'placeholder';
 // Inspect content before trusting a variable's name: XPUB can be misconfigured.
 if(/BEGIN (?:PGP PRIVATE KEY|(?:RSA |EC |OPENSSH )?PRIVATE KEY)/.test(text)||/^[xtuyzv]prv[1-9A-HJ-NP-Za-km-z]{80,}$/.test(text))return 'private_key_material';
 if(/PRIVATE_KEY_PATH$/.test(name))return 'private_key_location_reference';
 if(/XPUB/i.test(name))return 'public_wallet_identifier';
 if(/^UseDevelopmentStorage=true(?:;|$)/i.test(text)||/AccountName=devstoreaccount1(?:;|$)/i.test(text))return 'development_storage';
 if(/^(dev123|password|admin|test|secret)$/i.test(text))return 'weak_default';
 if(/(?:RPC_USER|RPC_PASS)/.test(name)&&['regtest','local-regtest-only'].includes(text))return 'development_credential';
 return 'potentially_live_secret';
}
export function rotationAction(name,classification) {
 name=String(name).toUpperCase();
 if(classification==='private_key_material'&&name.includes('XPUB'))return 'wallet_owner_private_key_exposure_review';
 if(classification==='private_key_location_reference')return 'verify_referenced_key_with_owner_do_not_publish_path';
 if(classification==='public_wallet_identifier')return 'wallet_owner_review_do_not_replace_without_invoice_recovery_plan';
 if(classification==='placeholder'||classification==='development_storage'||classification==='development_credential')return 'confirm_development_only';
 if(name==='HMAC_SECRET')return 'retire_from_new_runtime_keep_recovery_material_if_required';
 if(name.startsWith('LOCAL_TLS'))return 'development_certificate_review';
 if(/PGP|PRIVATE|PRV/.test(name))return 'trusted_key_owner_rotation_and_old_ciphertext_recovery_plan';
 return 'replace_in_owning_service_and_verify_all_consumers';
}
