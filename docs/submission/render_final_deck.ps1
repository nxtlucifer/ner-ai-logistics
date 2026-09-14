# Render the final deck with PowerPoint: PDF (portal upload), per-slide PNGs, and a
# text-overflow report (text bound taller/wider than its shape).
#   powershell -NoProfile -File docs/submission/render_final_deck.ps1
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pptx = Join-Path $root 'docs\submission\RASTA_AI_SIH26002_TEAM17_FINAL.pptx'
$pdf  = Join-Path $root 'docs\submission\RASTA_AI_SIH26002_TEAM17_FINAL.pdf'
$png  = Join-Path $root 'docs\submission\final-render'
if (Test-Path $png) { Remove-Item -Recurse -Force $png }
$app = New-Object -ComObject PowerPoint.Application
$d = $app.Presentations.Open($pptx, $true, $false, $false)
Write-Output ("slides: " + $d.Slides.Count)
$over = 0
foreach ($s in $d.Slides) {
  foreach ($sh in $s.Shapes) {
    if ($sh.HasTextFrame -and $sh.TextFrame.HasText) {
      $tr = $sh.TextFrame.TextRange
      $inner = $sh.Height - $sh.TextFrame.MarginTop - $sh.TextFrame.MarginBottom
      $innerW = $sh.Width - $sh.TextFrame.MarginLeft - $sh.TextFrame.MarginRight
      if ($tr.BoundHeight -gt $inner + 2) {
        $over++; Write-Output ("OVERFLOW-H slide " + $s.SlideIndex + " '" + $sh.Name + "' text=" + [math]::Round($tr.BoundHeight) + " box=" + [math]::Round($inner) + " :: " + $tr.Text.Substring(0, [math]::Min(60, $tr.Text.Length)))
      }
      if (-not $sh.TextFrame.WordWrap -and $tr.BoundWidth -gt $innerW + 2) {
        $over++; Write-Output ("OVERFLOW-W slide " + $s.SlideIndex + " '" + $sh.Name + "' :: " + $tr.Text.Substring(0, [math]::Min(60, $tr.Text.Length)))
      }
    }
  }
}
Write-Output ("overflow shapes: " + $over)
$d.SaveAs($pdf, 32)
$d.SaveAs($png, 18)
$d.Close(); $app.Quit()
Write-Output ("pdf: " + $pdf)
