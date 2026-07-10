<#
.SYNOPSIS
  Despliega PeruvianMarket a Vercel.
  Ejecutar desde: c:\Users\lecor\Documents\utec\crypto\proyecto11\web\

.EXAMPLE
  .\deploy.ps1        # Deploy de produccion
#>

Write-Host ''
Write-Host '========================================'  -ForegroundColor Cyan
Write-Host '  PeruvianMarket - Deploy a Vercel'       -ForegroundColor Cyan
Write-Host '========================================'  -ForegroundColor Cyan
Write-Host ''

# 1. Verificar Vercel CLI
Write-Host '[1/3] Verificando Vercel CLI...' -ForegroundColor Yellow
$vercelOk = Get-Command vercel -ErrorAction SilentlyContinue
if (-not $vercelOk) {
  Write-Host '      Instalando Vercel CLI...' -ForegroundColor Yellow
  npm install -g vercel
}
Write-Host '      OK' -ForegroundColor Green

# 2. Leer .env.local y mostrar las variables que Vercel necesita
Write-Host '[2/3] Leyendo .env.local...' -ForegroundColor Yellow

if (-not (Test-Path '.env.local')) {
  Write-Host 'ERROR: .env.local no encontrado.' -ForegroundColor Red
  exit 1
}

$envVars = @{}
Get-Content '.env.local' | Where-Object { $_ -notmatch '^#' -and $_ -match '=' } | ForEach-Object {
  $parts = $_ -split '=', 2
  if ($parts.Count -eq 2) {
    $envVars[$parts[0].Trim()] = $parts[1].Trim()
  }
}

$required = @('NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','ORACLE_PRIVATE_KEY')
$allOk = $true
foreach ($k in $required) {
  if (-not $envVars.ContainsKey($k) -or $envVars[$k] -match 'placeholder') {
    Write-Host "ERROR: '$k' tiene valor placeholder o no existe." -ForegroundColor Red
    $allOk = $false
  }
}
if (-not $allOk) { exit 1 }
Write-Host "      $($envVars.Count) variables encontradas. OK" -ForegroundColor Green

# 3. Deploy
Write-Host '[3/3] Ejecutando vercel --prod...' -ForegroundColor Yellow
Write-Host ''
Write-Host '  La primera vez Vercel te pedira:' -ForegroundColor Cyan
Write-Host '    - Login (abre el navegador, acepta)'
Write-Host '    - Nombre del proyecto (pon: peruvianmarket)'
Write-Host '    - Directorio (acepta el default con Enter)'
Write-Host ''

vercel --prod --yes

if ($LASTEXITCODE -eq 0) {
  Write-Host ''
  Write-Host '========================================'  -ForegroundColor Green
  Write-Host '  Build subido a Vercel!'                 -ForegroundColor Green
  Write-Host '========================================'  -ForegroundColor Green
  Write-Host ''
  Write-Host 'PASO OBLIGATORIO: agrega las variables de entorno en Vercel.' -ForegroundColor Yellow
  Write-Host 'Ve a: vercel.com -> tu proyecto -> Settings -> Environment Variables' -ForegroundColor Cyan
  Write-Host ''
  Write-Host 'Copia estos valores desde tu .env.local:' -ForegroundColor White
  foreach ($k in $envVars.Keys) {
    $v = $envVars[$k]
    $short = if ($v.Length -gt 40) { $v.Substring(0,40) + '...' } else { $v }
    Write-Host "  $k = $short" -ForegroundColor DarkGray
  }
  Write-Host ''
  Write-Host 'Despues de agregar las variables, haz Redeploy desde el dashboard.' -ForegroundColor Cyan
} else {
  Write-Host 'Deploy fallido (codigo $LASTEXITCODE). Revisa los errores arriba.' -ForegroundColor Red
}
