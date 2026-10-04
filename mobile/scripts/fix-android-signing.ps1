# Export / upload-key helpers for Google Play App Signing
# DO NOT commit keystores or PEMs.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host ""
Write-Host "=== Bonfyr Android signing fix ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "You currently have TWO EAS keystores. That is why Play says credentials are wrong."
Write-Host ""
Write-Host "  OLD (signed your first AAB ~2h ago):"
Write-Host "    Config: Build Credentials ymlE-muctf"
Write-Host "    SHA1:   44:FA:10:E6:5B:05:F6:25:4A:C4:62:83:B9:88:EF:06:8E:E0:6B:91"
Write-Host ""
Write-Host "  NEW (current EAS default — created later):"
Write-Host "    Config: Build Credentials 3iiHqOHaGW"
Write-Host "    SHA1:   0E:54:E2:16:14:0F:F5:98:B3:E5:85:41:07:A8:BC:3E:55:CD:6B:F5"
Write-Host "    PEM:    upload_certificate.pem  (already exported)"
Write-Host ""
Write-Host "Pick ONE path and stick to it:" -ForegroundColor Yellow
Write-Host ""
Write-Host "PATH A — Play has NOT accepted any AAB yet (recommended if first upload failed)"
Write-Host "  1. Keep NEW keystore as EAS default (already is)."
Write-Host "  2. In Play Console → App integrity → App signing:"
Write-Host "     upload  upload_certificate.pem  as the upload key if asked."
Write-Host "  3. Rebuild AAB with the NEW keystore:"
Write-Host "       `$env:EAS_NO_VCS=1; eas build -p android --profile production"
Write-Host "  4. Upload the NEW AAB (not the old app-release.aab)."
Write-Host ""
Write-Host "PATH B — Play already accepted an AAB signed with OLD key (SHA1 44:FA...)"
Write-Host "  1. eas credentials -p android → production"
Write-Host "  2. Choose keystore → set  ymlE-muctf  as DEFAULT"
Write-Host "  3. Download that keystore, then export PEM:"
Write-Host "       keytool -exportcert -rfc -alias <ALIAS> -file upload_certificate.pem -keystore <downloaded.jks>"
Write-Host "  4. Rebuild and upload with that same keystore."
Write-Host ""
Write-Host "Also for Google Sign-In after Play installs:" -ForegroundColor Yellow
Write-Host "  Google Cloud Console → Credentials → your Android OAuth client"
Write-Host "  Add package com.bonfire.app + BOTH SHA-1 fingerprints:"
Write-Host "    - Upload key SHA-1 (above)"
Write-Host "    - Play App Signing key SHA-1 (Play Console → App integrity)"
Write-Host ""
