# BeatMarker for After Effects:

BeatMarker is a dockable After Effects panel that analyzes music and places beat markers on an After Effects audio layer or composition timeline.

It is designed for editors who want a visible rhythm reference before making music-synced cuts, transitions, effects, or motion graphics.

> BeatMarker creates a strong first-pass beat grid. It does not promise perfect detection for every song, especially music with swing, tempo changes, syncopation, or heavy sound design.

## Install Without Programming

You do not need Node.js, Git, or coding knowledge to use the panel.

### 1. Download the project

On GitHub, click:

`Code` -> `Download ZIP`

Extract the ZIP file. If the extracted folder has a name such as `beatmarker-main`, rename it to:

`BeatMarker`

### 2. Copy it to the After Effects extensions folder

Close After Effects first.

Press `Windows + R`, paste this path, and press Enter:

```text
%APPDATA%\Adobe\CEP\extensions
```

If the `extensions` folder does not exist, create it.

Copy the complete `BeatMarker` folder into that directory.

The final path must look like this:

```text
%APPDATA%\Adobe\CEP\extensions\BeatMarker\CSXS\manifest.xml
```

Do not copy only the `CSXS` folder. Copy the entire project folder.

### 3. Enable CEP panels on Windows

Open PowerShell and run these commands:

```powershell
New-Item -Path "HKCU:\Software\Adobe\CSXS.10" -Force

New-ItemProperty `
  -Path "HKCU:\Software\Adobe\CSXS.10" `
  -Name PlayerDebugMode `
  -Value "1" `
  -PropertyType String `
  -Force
```

This enables locally installed unsigned CEP panels for the current Windows user.

### 4. Open BeatMarker

Start After Effects and open:

```text
Window > Extensions > BeatMarker
```

Depending on your After Effects version, the menu may appear under:

```text
Window > Extensions (Legacy) > BeatMarker
```

Verify the installation by opening a composition, selecting an audio layer, and
confirming that the BeatMarker panel loads before continuing to the usage steps.

## How To Use It

1. Open the composition you want to edit.
2. If you want markers on an audio layer, select it in the Timeline panel.
3. Open BeatMarker.
4. Click `Choose file`.
5. Select the same audio file used by the After Effects layer.
  The file is decoded and analyzed locally in the panel; it is not uploaded.
6. Leave `BPM override` empty or set it to `0` for automatic tempo estimation.
7. Click `Analyze beats`.
8. Check the waveform and beat lines.
9. Adjust sensitivity or offset if necessary.
10. Confirm that the intended composition is active.
11. Click `Write beat markers`.

With an audio layer selected, `Write beat markers` writes markers to that layer. With no audio layer selected, it writes markers to the active composition.

After writing the markers, scrub the timeline to confirm their positions. If the
beats are consistently early or late, set `Start offset` and analyze again.

## Controls

### BPM override

Use `0` for automatic BPM estimation.

Enter a known BPM to force a fixed grid:

```text
0       Automatic estimation
120     Fixed 120 BPM grid
119.7   Fixed 119.7 BPM grid
```

### Start offset

Offset is measured in milliseconds.

```text
100     Move markers 100 ms later
-80     Move markers 80 ms earlier
0       No timing adjustment
```

Use offset when the music has a pickup or the detected grid is consistently early or late.

### Detection sensitivity

Sensitivity controls how easily weaker transients are accepted.

Higher values may detect more beats. Lower values require stronger transients.

The default value is `0.55`.

### Replace existing markers

Enabled by default. When enabled, existing markers on the target layer or composition are removed before the new grid is written.

### Clear

Removes all markers from the current target.

## What The Detector Does

BeatMarker runs locally in the panel using the Web Audio API.

The current analysis pipeline is:

1. Decode the selected audio file.
2. Analyze the first audio channel.
3. Split audio into 1024-sample FFT windows.
4. Use a 256-sample hop size.
5. Apply a Hann window.
6. Calculate logarithmic spectral magnitude.
7. Measure positive spectral changes using spectral flux.
8. Smooth the onset envelope.
9. Estimate tempo over approximately 60-180 BPM.
10. Detect local transient peaks using a dynamic threshold.
11. Fit the beat-grid phase to the detected peaks.
12. Generate beat positions until the end of the file.

The detector uses this interval for the final grid:

```text
beat interval = 60 / BPM
```

## After Effects Marker Format

Markers are created as `MarkerValue` objects.

Example comments:

```text
Beat 1 | 119.7 BPM
Beat 2 | 119.7 BPM
Beat 3 | 119.7 BPM
```

Marker writing and clearing are grouped into After Effects undo operations.

## Accuracy And Limitations

BeatMarker is a first-pass editing assistant, not a complete music-information-retrieval system.

Results can be less reliable with:

- Swing or shuffled rhythms
- Tempo changes
- Rubato performances
- Syncopated music
- Ambient or cinematic sound design
- Heavy reverb
- Weak transients
- Multiple competing rhythms
- Half-time or double-time interpretations
- Long intros without a clear beat

The current version assumes mostly constant BPM and does not provide automatic downbeat detection, variable-tempo tracking, swing detection, confidence values, or manual beat correction before writing.

For variable-tempo music, analyze shorter sections separately.

## Developer Information

BeatMarker is a CEP extension, not a native `.aex` effect.

### Project structure

```text
BeatMarker/
├── CSXS/
│   └── manifest.xml       CEP registration
├── jsx/
│   └── host.jsx           After Effects ExtendScript bridge
├── index.html             Panel markup
├── panel.js               Audio analysis and CEP calls
├── styles.css             Panel styling
├── package.json           Development check script
├── showcase-video/        Editable promotional video project
└── assets/screenshots      Supplied interface screenshots
```

### JavaScript responsibilities

`panel.js` handles:

- Local audio file selection
- Web Audio decoding
- Waveform drawing
- FFT calculation
- Spectral-flux onset detection
- BPM estimation
- Phase fitting
- Beat-grid generation
- CEP `evalScript` calls

### ExtendScript responsibilities

`jsx/host.jsx` handles:

- Reading the active composition
- Finding the selected audio layer
- Selecting layer markers or composition markers
- Removing existing markers
- Creating `MarkerValue` objects
- Writing marker keys at calculated times
- Returning JSON results to the panel

### Development check

Node.js is only required for development checks, not for ordinary users installing the panel.

From the project directory, run:

```powershell
npm install
npm run check
```

The check validates the syntax of `panel.js`.

### Manifest details

The CEP manifest is in `CSXS/manifest.xml`.

The current manifest registers:

```text
Extension ID: com.beatmarker.panel
Menu name: BeatMarker
Panel type: CEP Panel
Required CEP runtime: CSXS 10.0
After Effects host family: AEFT
```

### Important implementation detail

The panel asks the user to choose the audio file separately instead of decoding the source file directly from After Effects. This keeps the audio analysis in the browser panel and avoids trying to decode audio through ExtendScript.

## Showcase Video

The editable showcase project is in `showcase-video/`.
It is optional and is not required to install or use the After Effects panel.

Rendered video output is not included in the repository. Use the showcase project's
render command to generate the promotional video locally.

It is a 30-second, 1920x1080, 30 FPS H.264/AAC motion-graphics promo using the supplied BeatMarker screenshots, synchronized scene-specific voiceover, music, waveform motion, marker animations, callouts, and an animated end card.

## Troubleshooting

### BeatMarker does not appear in the Window menu

- Confirm the folder is inside `%APPDATA%\Adobe\CEP\extensions`.
- Confirm `CSXS\manifest.xml` is directly inside the `BeatMarker` folder.
- Confirm `PlayerDebugMode` was enabled.
- Restart After Effects.
- Try `Window > Extensions (Legacy)`.

### The panel opens but says it is not inside After Effects

The panel was opened in a normal browser. Open it from After Effects instead.

### No composition is detected

Open a composition and make it active before opening or refreshing BeatMarker.

### No audio is available for analysis

Select the audio layer in the Timeline panel and choose the matching source file
in BeatMarker before clicking `Analyze beats`.

### Markers go to the composition instead of the audio layer

Select the audio layer in the Timeline panel before clicking `Write beat markers`.

### The BPM is wrong

Enter the known BPM in `BPM override`, then analyze again. You can also adjust sensitivity and start offset.

### The markers are consistently early or late

Use `Start offset` in milliseconds and analyze again.

## License

No license has been selected yet. Add a license before publishing a public release if you want others to legally reuse or modify the code.
