function getActiveTarget() {
    var result = { comp: null, layer: null };
    if (!app.project || !app.project.activeItem || !(app.project.activeItem instanceof CompItem)) {
        return result;
    }
    result.comp = app.project.activeItem;
    var selected = result.comp.selectedLayers;
    for (var i = 0; i < selected.length; i++) {
        if (selected[i].canSetAudio) {
            result.layer = selected[i];
            break;
        }
    }
    return result;
}

function getTargetInfo() {
    var target = getActiveTarget();
    if (!target.comp) {
        return JSON.stringify({ ok: false, message: "Open a composition first." });
    }
    var sourcePath = "";
    var layerName = "Composition markers";
    if (target.layer) {
        layerName = target.layer.name;
        if (target.layer.source && target.layer.source.file) {
            sourcePath = target.layer.source.file.fsName;
        }
    }
    return JSON.stringify({
        ok: true,
        compName: target.comp.name,
        layerName: layerName,
        sourcePath: sourcePath,
        hasAudioLayer: !!target.layer
    });
}

function writeBeatMarkers(payload) {
    var data = JSON.parse(payload);
    var target = getActiveTarget();
    if (!target.comp) {
        return JSON.stringify({ ok: false, message: "Open a composition first." });
    }
    var markerProperty = target.layer ? target.layer.marker : target.comp.markerProperty;
    app.beginUndoGroup("BeatMarker: write beats");
    try {
        if (data.replaceExisting) {
            while (markerProperty.numKeys > 0) {
                markerProperty.removeKey(1);
            }
        }
        for (var i = 0; i < data.beats.length; i++) {
            var beat = data.beats[i];
            var marker = new MarkerValue("Beat " + (i + 1) + " | " + data.bpm.toFixed(1) + " BPM");
            marker.duration = 0;
            markerProperty.setValueAtTime(beat.time, marker);
        }
        return JSON.stringify({
            ok: true,
            count: data.beats.length,
            target: target.layer ? target.layer.name : target.comp.name
        });
    } catch (error) {
        return JSON.stringify({ ok: false, message: String(error) });
    } finally {
        app.endUndoGroup();
    }
}

function clearBeatMarkers() {
    var target = getActiveTarget();
    if (!target.comp) {
        return JSON.stringify({ ok: false, message: "Open a composition first." });
    }
    var markerProperty = target.layer ? target.layer.marker : target.comp.markerProperty;
    app.beginUndoGroup("BeatMarker: clear beats");
    try {
        while (markerProperty.numKeys > 0) {
            markerProperty.removeKey(1);
        }
        return JSON.stringify({ ok: true, target: target.layer ? target.layer.name : target.comp.name });
    } catch (error) {
        return JSON.stringify({ ok: false, message: String(error) });
    } finally {
        app.endUndoGroup();
    }
}
