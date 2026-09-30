# Stratum: fetch the inference runtime and weights (skips anything already on disk),
# then write Stratum's own llama-swap config (stratum.yaml, served on :8090).
# Shares the runtime root with Faraday (D:\ai where a D: drive exists); never edits
# Faraday's config.yaml.

param(
	[string]$Root = $(if (Test-Path "D:\") { "D:\ai" } else { Join-Path $env:LOCALAPPDATA "stratum-runtime" })
)

$ErrorActionPreference = "Stop"
$root = $Root
Write-Host "runtime root: $root"
New-Item -ItemType Directory -Force -Path "$root\dl", "$root\models", "$root\llama-swap", "$root\llama.cpp" | Out-Null

$targets = @(
	@{ name = "llama-swap v251";         url = "https://github.com/mostlygeek/llama-swap/releases/download/v251/llama-swap_251_windows_amd64.zip"; out = "$root\dl\llama-swap_251_windows_amd64.zip"; done = "$root\llama-swap\llama-swap.exe" }
	@{ name = "llama.cpp b10687 vulkan"; url = "https://github.com/ggml-org/llama.cpp/releases/download/b10687/llama-b10687-bin-win-vulkan-x64.zip"; out = "$root\dl\llama-b10687-bin-win-vulkan-x64.zip"; done = "$root\llama.cpp\llama-server.exe" }
	@{ name = "text Q4_K_M";             url = "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf"; out = "$root\models\Qwen3-4B-Q4_K_M.gguf"; done = "$root\models\Qwen3-4B-Q4_K_M.gguf" }
	@{ name = "vision Q4_K_M";           url = "https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3VL-2B-Instruct-Q4_K_M.gguf"; out = "$root\models\Qwen3VL-2B-Instruct-Q4_K_M.gguf"; done = "$root\models\Qwen3VL-2B-Instruct-Q4_K_M.gguf" }
	@{ name = "vision mmproj Q8_0";      url = "https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"; out = "$root\models\mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"; done = "$root\models\mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf" }
)

foreach ($t in $targets) {
	if ((Test-Path $t.done) -or (Test-Path $t.out)) { Write-Host "SKIP  $($t.name)"; continue }
	Write-Host "GET   $($t.name)"
	& curl.exe -L --fail --retry 3 --retry-delay 2 -o $t.out $t.url
	if ($LASTEXITCODE -ne 0) { throw "failed: $($t.name) ($($t.url))" }
}

if (-not (Test-Path "$root\llama-swap\llama-swap.exe")) { Expand-Archive -Force -Path "$root\dl\llama-swap_251_windows_amd64.zip" -DestinationPath "$root\llama-swap" }
if (-not (Test-Path "$root\llama.cpp\llama-server.exe")) { Expand-Archive -Force -Path "$root\dl\llama-b10687-bin-win-vulkan-x64.zip" -DestinationPath "$root\llama.cpp" }

$template = Join-Path $PSScriptRoot "..\runtime\llama-swap.config.yaml"
$devices = & "$root\llama.cpp\llama-server.exe" --list-devices 2>&1 | Out-String
$discrete = $null
foreach ($line in ($devices -split "`n")) {
	if ($line -match '(Vulkan\d+):\s*(.+?)\s*\(') {
		Write-Host "      $($Matches[1]) = $($Matches[2])"
		if ($Matches[2] -match 'NVIDIA|Radeon RX|Arc') { $discrete = $Matches[1] }
	}
}
if ($null -eq $discrete) {
	# The discrete card can be disabled in Device Manager or asleep behind Optimus.
	# Fall back to whatever Vulkan device exists (usually the iGPU) rather than refusing:
	# slower, but everything works, and re-running this script picks the card up later.
	if ($devices -match '(Vulkan\d+):') { $discrete = $Matches[1] } else { throw "no Vulkan device found in --list-devices" }
	Write-Warning "no discrete GPU visible to Vulkan — using $discrete. Enable the NVIDIA GPU in Device Manager and re-run 'run.bat models' for full speed."
}

(Get-Content -Raw $template).Replace('__RUNTIME_ROOT__', ($root -replace '\\','/')).Replace('__DISCRETE_GPU__', $discrete) |
	Set-Content -NoNewline -Path "$root\llama-swap\stratum.yaml"
Write-Host "OK    $root\llama-swap\stratum.yaml (pinned to $discrete)"
