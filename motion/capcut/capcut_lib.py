"""Write editable CapCut desktop (Mac, 9.x) projects from Python. Reference: reference/CAPCUT.md.

    import sys; sys.path.insert(0, '<skill>/capcut'); from capcut_lib import Draft
    d = Draft('9x16', 'Brand - Concept 9x16')                    # canvas from the format
    d.fonts(display='assets/fonts/x.woff2', ui='assets/fonts/y.woff2')   # woff2/ttf → TTF inside the draft
    d.video('assets/real/a.MOV', t0=0, t1=1.2, src_in=1.0, box=None, pos=(.5,.4), z=1.05, track=0, label='01 hook')
    d.text('Es\\nlifting.', [('Es\\n', 75, 'display'), ('lifting.', 150, 'display')], x=100, y=1300, t0=3.6, t1=6.0)
    d.audio('audio/music.wav', 0, 20, volume=.75, title='Música', track='música')
    d.write()            # refuses while CapCut runs; copies media into <draft>/media (ASCII names); registers the draft

Everything is in FILM px / seconds; the library converts:
  • time → microseconds;  position → clip.transform (−1..1 from the canvas centre, y up) — CapCut's UI shows
    X = tx·W and Y = −ty·H (Y DOWN);  text size → CapCut size = design px ÷ 11 × (1920 / canvas WIDTH) — CapCut sizes are
    width-relative (client-calibrated on 16:9 and 9:16); rendered ≈ 0.79 × design px, so a box keeps the design's left edge / top line.
  • video framing reproduces film.js cover-fit (box, pos, z): full-canvas boxes use scale+offset, smaller boxes
    (split screen, grid cells, 16:9 panel) crop the material to the visible part and fit the crop into the box.
Sandbox: CapCut only reads media inside its own draft folder → every file is copied into <draft>/media/.
"""
import json, os, re, sys, copy, time, uuid, shutil, subprocess, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.expanduser('~/Movies/CapCut/User Data/Projects/com.lveditor.draft')
def _home(o):
    """Las plantillas guardan {HOME} en lugar de rutas de una Mac concreta."""
    if isinstance(o, str): return o.replace('{HOME}', os.path.expanduser('~'))
    if isinstance(o, list): return [_home(x) for x in o]
    if isinstance(o, dict): return {k: _home(v) for k, v in o.items()}
    return o

SCHEMA = _home(json.load(open(os.path.join(HERE, 'schema', 'samples.json'))))
SKELETON = os.path.join(HERE, 'schema', 'skeleton')
# motion presets cloned from the user's own drafts: transitions + text in/out animations (CapCut re-fetches the effect by id)
EFFECTS = _home(json.load(open(os.path.join(HERE, 'schema', 'effects.json'))))
SIZE = {'9x16': (1080, 1920), '4x5': (1080, 1350), '1x1': (1080, 1080), '16x9': (1920, 1080)}
DIV, KR = 11.0, 8.7            # calibration (client fixes 2026-10-12: 16:9 → 12 for 132 px; 9:16 → 18 for 116 px)
# CapCut text size is relative to the canvas WIDTH: size = design px ÷ 11 × (1920 / W); it then renders ≈ design px × 8.7 / 11
# in every format (≈ 0.79 × design px — the client's preferred scale).
US = 1_000_000
INK = [0.965, 0.941, 0.906]    # default text colour (#f6f0e7); pass color=[r,g,b] (0..1) per text
uid = lambda: str(uuid.uuid4()).upper()
us = lambda s: int(round(s * US))
FULL_CROP = {'upper_left_x': 0.0, 'upper_left_y': 0.0, 'upper_right_x': 1.0, 'upper_right_y': 0.0,
             'lower_left_x': 0.0, 'lower_left_y': 1.0, 'lower_right_x': 1.0, 'lower_right_y': 1.0}


def capcut_running():
    return bool(subprocess.run(['pgrep', '-f', 'CapCut.app/Contents/MacOS/CapCut'], capture_output=True).stdout.strip())


def ascii_name(p):
    n = unicodedata.normalize('NFKD', os.path.basename(p)).encode('ascii', 'ignore').decode()
    return re.sub(r'[^A-Za-z0-9._-]+', '_', n).strip('_') or 'media'


def probe(path):
    """duration (s), DISPLAYED width/height (rotation metadata applied); audio-only files → (dur, 0, 0)."""
    j = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
        'stream=codec_type,width,height:stream_side_data=rotation:format=duration', '-of', 'json', path]).decode())
    v = next((s for s in j.get('streams', []) if s.get('codec_type') == 'video'), None)
    d = float(j['format']['duration'])
    if not v: return d, 0, 0
    w, h = v['width'], v['height']
    rot = next((abs(int(sd.get('rotation', 0))) for sd in v.get('side_data_list', []) if 'rotation' in sd), 0)
    return (d, h, w) if rot in (90, 270) else (d, w, h)


def place(W, H, iw, ih, box, pos, z, rot180=False):
    """(crop, scale, tx, ty) reproducing film.js drawImg(box, pos, z) on a W×H canvas."""
    bx, by, bw, bh = box['x'], box['y'], box['w'], box['h']
    sc = max(bw / iw, bh / ih) * z; dw, dh = iw * sc, ih * sc
    left, top = bx + (bw - dw) * pos[0], by + (bh - dh) * pos[1]
    if (bx, by, bw, bh) == (0, 0, W, H):                       # full canvas: canvas edge does the clipping
        fit = min(W / iw, H / ih)
        return dict(FULL_CROP), sc / fit, (left + dw / 2 - W / 2) / (W / 2), -(top + dh / 2 - H / 2) / (H / 2)
    u0, u1 = max(0, (bx - left) / dw), min(1, (bx + bw - left) / dw)
    v0, v1 = max(0, (by - top) / dh), min(1, (by + bh - top) / dh)
    if rot180: u0, u1, v0, v1 = 1 - u1, 1 - u0, 1 - v1, 1 - v0
    c = {'upper_left_x': u0, 'upper_left_y': v0, 'upper_right_x': u1, 'upper_right_y': v0,
         'lower_left_x': u0, 'lower_left_y': v1, 'lower_right_x': u1, 'lower_right_y': v1}
    cw, ch = (u1 - u0) * iw, (v1 - v0) * ih
    fit = min(W / cw, H / ch)
    return c, bw / (cw * fit), (bx + bw / 2 - W / 2) / (W / 2), -(by + bh / 2 - H / 2) / (H / 2)


def to_ttf(src, dst):
    if src.lower().endswith('.ttf'): shutil.copy(src, dst); return dst
    from fontTools.ttLib import TTFont                         # uv pip install --python .venv/bin/python fonttools brotli
    f = TTFont(src); f.flavor = None; f.save(dst); return dst


class Draft:
    def __init__(self, fmt, name, root=ROOT, fps=30.0, duration=None):
        self.fmt, self.name, self.root, self.fps = fmt, name, root, fps
        self.W, self.H = SIZE[fmt]
        self.folder = os.path.join(root, name)
        self.media = os.path.join(self.folder, 'media')
        self._videos, self._texts, self._audios = [], [], []
        self._fonts = {}
        self.duration = duration

    # ---------------------------------------------------------------- API
    def fonts(self, display, ui=None):
        self._fonts = {'display': display, 'ui': ui or display}

    def video(self, path, t0, t1, src_in=0.0, box=None, pos=(0.5, 0.5), z=1.0, rot180=False, track=0, label='', volume=0.0, plain=False,
              kf=None, trans_out=None, trans_dur=None):
        """plain=True: put the file as is (scale 1, centred) — for rendered graphic clips at canvas size.
        kf = [(t_seconds_into_clip, scale_multiplier), …] → native CapCut scale keyframes (push-ins, punches, pops).
        trans_out = transition preset name (EFFECTS['transitions'], e.g. 'Heat Swipe') placed on the cut AFTER this clip."""
        self._videos.append(dict(path=path, t0=t0, t1=t1, src_in=src_in, box=box, pos=pos, z=z, rot180=rot180, track=track,
                                 label=label, volume=volume, plain=plain, kf=kf, trans_out=trans_out, trans_dur=trans_dur))

    def text(self, text, parts, x, y, t0, t1, color=None, name='', anim_in=None, anim_in_dur=0.4, anim_out=None, anim_out_dur=0.3, stroke=None):
        """parts = [(substring, design_px, 'display'|'ui'), …] concatenating to text; (x, y) = block's top-left in film px.
        stroke = ([r,g,b] 0..1, width) → CapCut text outline (width as in the UI's stroke slider / 100, e.g. 0.08)."""
        assert ''.join(p[0] for p in parts) == text, 'parts must concatenate to text'
        pcolors = [p[3] if len(p) > 3 else None for p in parts]          # optional 4th item: per-part colour [r,g,b] (accent words)
        parts = [tuple(p[:3]) for p in parts]
        self._texts.append(dict(text=text, parts=parts, pcolors=pcolors, x=x, y=y, t0=t0, t1=t1, color=color or INK, name=name,
                                anim_in=anim_in, anim_in_dur=anim_in_dur, anim_out=anim_out, anim_out_dur=anim_out_dur, stroke=stroke))

    def audio(self, path, t0, t1, volume=1.0, title='', track='audio', src_in=0.0):
        self._audios.append(dict(path=path, t0=t0, t1=t1, volume=volume, title=title or os.path.basename(path), track=track, src_in=src_in))

    # ---------------------------------------------------------------- internals
    def _copy_in(self, src, sub=''):
        d = os.path.join(self.media, sub); os.makedirs(d, exist_ok=True)
        dst = os.path.join(d, ascii_name(src))
        if not os.path.exists(dst): shutil.copy2(src, dst)
        return dst

    def _measure(self, parts):
        from PIL import ImageFont
        lines, cur = [], []
        for tx, size, font in parts:
            for i, s in enumerate(tx.split('\n')):
                if i: lines.append(cur); cur = []
                if s: cur.append((s, size, font))
        lines.append(cur)
        w = h = 0
        for ln in lines:
            w = max(w, sum(ImageFont.truetype(self._ttf[f], max(1, int(sz))).getlength(t) for t, sz, f in ln) if ln else 0)
            h += max([sz for _, sz, _ in ln], default=parts[-1][1]) * 1.22
        return w, h

    def _extras(self, sample, mats):
        refs = []
        for kind, m in sample:
            e = copy.deepcopy(m); e['id'] = uid(); mats.setdefault(kind, []).append(e); refs.append(e['id'])
        return refs

    def write(self):
        if os.path.abspath(self.root) == os.path.abspath(ROOT) and capcut_running():
            sys.exit('CapCut is running — close it first (it rewrites drafts on save)')
        if os.path.exists(self.folder): sys.exit(f'refusing: {self.folder} already exists')
        W, H, short = self.W, self.H, min(self.W, self.H)
        shutil.copytree(SKELETON, self.folder)
        os.makedirs(self.media, exist_ok=True)
        self._ttf = {k: to_ttf(v, os.path.join(self.media, ascii_name(os.path.splitext(v)[0]) + '.ttf')) for k, v in self._fonts.items()}
        sv, st, sa = SCHEMA['video'], SCHEMA['text'], SCHEMA['audio']
        info = json.load(open(os.path.join(SKELETON, 'draft_info.json')))
        mats = {k: [] for k in info.get('materials', {})}
        tracks, used = [], []
        dur = self.duration or max([v['t1'] for v in self._videos] + [a['t1'] for a in self._audios] + [t['t1'] for t in self._texts])

        vtracks = {}
        for v in self._videos:
            path = self._copy_in(v['path'], 'video'); d, iw, ih = probe(path)
            if v['plain']: crop, scale, tx, ty = dict(FULL_CROP), 1.0, 0.0, 0.0
            else: crop, scale, tx, ty = place(W, H, iw, ih, v['box'] or {'x': 0, 'y': 0, 'w': W, 'h': H}, v['pos'], v['z'], v['rot180'])
            length = min(v['t1'] - v['t0'], d - v['src_in'])
            m = copy.deepcopy(sv['material'][1]); m.update(id=uid(), path=path, material_name=os.path.basename(path), duration=us(d),
                                                           width=iw, height=ih, local_material_id='', type='video', crop=crop)
            mats.setdefault('videos', []).append(m)
            seg = copy.deepcopy(sv['segment']); seg.update(id=uid(), material_id=m['id'], extra_material_refs=self._extras(sv['extras'], mats),
                source_timerange={'start': us(v['src_in']), 'duration': us(length)}, target_timerange={'start': us(v['t0']), 'duration': us(length)},
                speed=1.0, volume=v['volume'], last_nonzero_volume=1.0, render_index=v['track'], track_render_index=v['track'],
                keyframe_refs=[], common_keyframes=[], desc=v['label'],
                clip={'scale': {'x': scale, 'y': scale}, 'rotation': 180.0 if v['rot180'] else 0.0, 'transform': {'x': tx, 'y': ty},
                      'flip': {'vertical': False, 'horizontal': False}, 'alpha': 1.0})
            for e in mats.get('speeds', []):
                if e['id'] in seg['extra_material_refs']: e['speed'] = 1.0
            if v['kf']:
                seg['uniform_scale'] = {'on': True, 'value': 1.0}
                seg['common_keyframes'] = [{'id': uid(), 'material_id': '', 'property_type': 'KFTypeScaleX', 'keyframe_list': [
                    {'id': uid(), 'curveType': 'Line', 'time_offset': max(0, min(us(length), us(tt))), 'left_control': {'x': 0.0, 'y': 0.0},
                     'right_control': {'x': 0.0, 'y': 0.0}, 'values': [scale * mul], 'string_value': '', 'graphID': ''} for tt, mul in v['kf']]}]
            if v['trans_out']:
                tr = copy.deepcopy(EFFECTS['transitions'][v['trans_out']]); tr['id'] = uid()
                if v['trans_dur']: tr['duration'] = us(v['trans_dur'])
                mats.setdefault('transitions', []).append(tr); seg['extra_material_refs'].append(tr['id'])
            if v['track'] not in vtracks:
                vtracks[v['track']] = copy.deepcopy(sv['track']); vtracks[v['track']].update(id=uid(), segments=[], flag=0 if v['track'] == 0 else 2,
                    attribute=0, name='' if v['track'] == 0 else f'superpuesta {v["track"]}')
            vtracks[v['track']]['segments'].append(seg); used.append(path)
        for k in sorted(vtracks):
            vtracks[k]['segments'].sort(key=lambda s: s['target_timerange']['start']); tracks.append(vtracks[k])

        for n, t in enumerate(self._texts):
            cap = [round(px / DIV * (1920 / W), 2) for _, px, _ in t['parts']]          # width-relative size
            wpx, hpx = self._measure([(s, px * KR / DIV, f) for (s, px, f) in t['parts']])  # rendered px (format-independent)
            cx, cy = t['x'] + wpx / 2, t['y'] + hpx / 2
            styles, pos = [], 0
            for (s, _, f), c, pc in zip(t['parts'], cap, t.get('pcolors') or [None] * len(t['parts'])):
                n16 = len(s.encode('utf-16-le')) // 2
                styles.append({'fill': {'content': {'solid': {'color': pc or t['color']}, 'render_type': 'solid'}}, 'range': [pos, pos + n16],
                               'size': c, 'font': {'path': self._ttf[f], 'id': ''}, 'useLetterColor': True})
                if t.get('stroke'): styles[-1]['strokes'] = [{'width': t['stroke'][1], 'mode': 0, 'content': {'solid': {'color': t['stroke'][0]}}}]
                pos += n16
            f0 = self._ttf[t['parts'][-1][2]]
            m = copy.deepcopy(st['material']); m.update(id=uid(), type='text', content=json.dumps({'styles': styles, 'text': t['text']}, ensure_ascii=False),
                font_path=f0, font_name=os.path.splitext(os.path.basename(f0))[0], font_size=max(cap), text_color='#%02x%02x%02x' % tuple(int(c * 255) for c in t['color']),
                alignment=0, typesetting=0, line_spacing=0.02, letter_spacing=0.0, line_max_width=1.0, has_shadow=False, border_width=0.0,
                base_content='', words={'start_time': [], 'end_time': [], 'text': []}, recognize_text='', name='')
            if t.get('stroke'): m.update(border_width=t['stroke'][1], border_color='#%02x%02x%02x' % tuple(int(c * 255) for c in t['stroke'][0]), border_alpha=1.0)
            mats.setdefault('texts', []).append(m)
            if t['anim_in'] or t['anim_out']:
                anims = []
                for kind, name, adur in (('in', t['anim_in'], t['anim_in_dur']), ('out', t['anim_out'], t['anim_out_dur'])):
                    if not name: continue
                    a = copy.deepcopy(EFFECTS['text_animations'][f'{kind}:{name}']['animation']); a['duration'] = us(adur)
                    a['start'] = 0 if kind == 'in' else us(t['t1'] - t['t0'] - adur); anims.append(a)
                t['_anims'] = anims
            tt = copy.deepcopy(st['track']); tt.update(id=uid(), segments=[], name=t['name'] or f'texto {n + 1:02d}')
            refs = self._extras(st['extras'], mats)
            if t.get('_anims'):
                for e in mats.get('material_animations', []):
                    if e['id'] in refs: e['animations'] = t['_anims']
            seg = copy.deepcopy(st['segment']); seg.update(id=uid(), material_id=m['id'], extra_material_refs=refs,
                target_timerange={'start': us(t['t0']), 'duration': us(t['t1'] - t['t0'])}, source_timerange=None,
                render_index=14000 + n, track_render_index=10 + n, keyframe_refs=[], common_keyframes=[],
                clip={'scale': {'x': 1.0, 'y': 1.0}, 'rotation': 0.0, 'transform': {'x': (cx - W / 2) / (W / 2), 'y': -(cy - H / 2) / (H / 2)},
                      'flip': {'vertical': False, 'horizontal': False}, 'alpha': 1.0})
            tt['segments'].append(seg); tracks.append(tt)

        atracks = {}
        for a in self._audios:
            path = self._copy_in(a['path'], 'audio'); d = probe(path)[0]
            length = min(a['t1'] - a['t0'], d - a['src_in'])
            m = copy.deepcopy(sa['material'][1]); m.update(id=uid(), path=path, name=a['title'], duration=us(d), type='extract_music', category_name='local')
            mats.setdefault('audios', []).append(m)
            seg = copy.deepcopy(sa['segment']); seg.update(id=uid(), material_id=m['id'], extra_material_refs=self._extras(sa['extras'], mats),
                source_timerange={'start': us(a['src_in']), 'duration': us(length)}, target_timerange={'start': us(a['t0']), 'duration': us(length)},
                speed=1.0, volume=a['volume'], keyframe_refs=[], common_keyframes=[])
            for e in mats.get('speeds', []):
                if e['id'] in seg['extra_material_refs']: e['speed'] = 1.0
            if a['track'] not in atracks:
                atracks[a['track']] = copy.deepcopy(sa['track']); atracks[a['track']].update(id=uid(), segments=[], name=a['track'])
            atracks[a['track']]['segments'].append(seg)
        tracks += list(atracks.values())

        did, tid, now = uid(), uid(), int(time.time() * US)
        info.update(id=tid, name='', duration=us(dur), fps=self.fps, create_time=now // US, update_time=now // US, tracks=tracks)
        info['canvas_config'] = {'ratio': 'original', 'width': W, 'height': H, 'background': None}
        info['materials'] = {**info.get('materials', {}), **mats}
        tl = os.path.join(self.folder, 'Timelines')
        for x in os.listdir(tl):
            p = os.path.join(tl, x)
            if os.path.isdir(p): shutil.rmtree(p)
            elif x.endswith('.bak'): os.remove(p)
        os.makedirs(os.path.join(tl, tid))
        for p in [os.path.join(self.folder, 'draft_info.json'), os.path.join(tl, tid, 'draft_info.json')]:
            json.dump(info, open(p, 'w'), ensure_ascii=False)
        proj = json.load(open(os.path.join(tl, 'project.json')))
        proj.update(id=uid(), main_timeline_id=tid, create_time=now, update_time=now,
                    timelines=[{'create_time': now, 'id': tid, 'is_marked_delete': False, 'name': 'Timeline 01', 'update_time': now}])
        json.dump(proj, open(os.path.join(tl, 'project.json'), 'w'))
        json.dump({'dockItems': [{'dockIndex': 0, 'ratio': 1, 'timelineIds': [tid], 'timelineNames': ['Timeline 01']}], 'layoutOrientation': 1},
                  open(os.path.join(self.folder, 'timeline_layout.json'), 'w'))
        for x in ('draft_info.json.bak',):
            if os.path.exists(os.path.join(self.folder, x)): os.remove(os.path.join(self.folder, x))
        if used:
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '0.3', '-i', used[min(1, len(used) - 1)], '-frames:v', '1', '-vf', 'scale=-2:480',
                            os.path.join(self.folder, 'draft_cover.jpg')], check=False)
        meta = _home(json.load(open(os.path.join(self.folder, 'draft_meta_info.json'))))
        vids = [{'create_time': now // US, 'duration': us(probe(p)[0]), 'extra_info': os.path.basename(p), 'file_Path': p, 'height': probe(p)[2],
                 'id': str(uuid.uuid4()), 'import_time': now // US, 'import_time_ms': now, 'item_source': 1, 'md5': '', 'metetype': 'video',
                 'roughcut_time_range': {'duration': -1, 'start': -1}, 'sub_time_range': {'duration': -1, 'start': -1}, 'type': 0, 'width': probe(p)[1]}
                for p in dict.fromkeys(used)]
        meta.update(draft_id=did, draft_name=self.name, draft_fold_path=self.folder, draft_root_path=self.root, tm_duration=us(dur),
                    tm_draft_create=now, tm_draft_modified=now, draft_cover='draft_cover.jpg', draft_timeline_materials_size_=0,
                    draft_materials=[{'type': 0, 'value': vids}] + [{'type': k, 'value': []} for k in (1, 2, 3, 6, 7, 8)])
        json.dump(meta, open(os.path.join(self.folder, 'draft_meta_info.json'), 'w'), ensure_ascii=False)
        rp = os.path.join(self.root, 'root_meta_info.json')
        if os.path.exists(rp):
            os.makedirs('capcut_export', exist_ok=True)
            shutil.copy(rp, f'capcut_export/root_meta_info.backup.{int(time.time())}.json')
            root = json.load(open(rp))
            e = copy.deepcopy(root['all_draft_store'][0]) if root.get('all_draft_store') else {}
            e.update(draft_cover=os.path.join(self.folder, 'draft_cover.jpg'), draft_fold_path=self.folder, draft_id=did,
                     draft_json_file=os.path.join(self.folder, 'draft_info.json'), draft_name=self.name, draft_root_path=self.root,
                     tm_draft_create=now, tm_draft_modified=now, tm_duration=us(dur), tm_draft_removed=0, draft_timeline_materials_size=0)
            root.setdefault('all_draft_store', []).insert(0, e)
            json.dump(root, open(rp, 'w'), ensure_ascii=False)
        print(f'{self.fmt}: {self.folder}  ({len(self._videos)} video, {len(self._texts)} text, {len(self._audios)} audio clips)')
        return self.folder
