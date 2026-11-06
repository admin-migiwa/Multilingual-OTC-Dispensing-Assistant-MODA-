# ナレーションの音声を、Windows に入っている日本語の音声で作る（パソコンの中だけで作り、外部には送らない）。
# 使い方：powershell -File tts.ps1 -TextFile 文.txt -Out 出力.wav [-Voice Ayumi] [-Pitch 1.0] [-Rate 1.0]
# Pitch は声の高さ（0〜2、1が標準）、Rate は話す速さ（0.5〜6、1が標準）
param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Voice = "Ayumi",
  [double]$Pitch = 1.0,
  [double]$Rate = 1.0
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait()
  $task.Result
}

$text = [IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8).Trim()
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -like "*$Voice*" -and $_.Language -eq "ja-JP" } | Select-Object -First 1
if (-not $v) { throw "日本語の音声「$Voice」が見つかりません" }
$synth.Voice = $v
$synth.Options.AudioPitch = $Pitch
$synth.Options.SpeakingRate = $Rate
$stream = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
$size = [uint32]$stream.Size
$null = Await ($reader.LoadAsync($size)) ([uint32])
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[IO.File]::WriteAllBytes($Out, $bytes)
