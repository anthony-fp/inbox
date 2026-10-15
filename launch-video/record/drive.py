"""Records one take of the side-by-side beat in the VM. It starts the window recorder on this Mac, sends each of the
beat's clicks into the VM at the time the timeline gives it, and logs them on the recorder's clock.

    python3 record/drive.py <look> [variant]      look: terminal, desktop or codex

Before a take, set the app up in the VM with the inbox docked, in the demo, on Needs you with the
first question open. The take is saved to takes/side-by-side-<look>.mov, with the recorder's sidecar and
the click log beside it. cut.py turns it into the clip the video plays.

VM_HOST names the VM's SSH address, admin@<ip> by default from `tart ip inbox-ui`.
"""
import json
import os
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TAKES = os.path.join(ROOT, 'takes')
RECORDER = os.path.join(ROOT, 'out', 'record')
WINDOW = 'inbox-ui'
# Seconds recorded before the beat's first frame and after its last.
LEAD, TAIL = 2.0, 1.0
# How long before each click the pointer moves onto its target, so the target's hover state is in the take when the
# pointer the video draws arrives.
HOVER_LEAD = 0.3


def vm_host():
    if os.environ.get('VM_HOST'):
        return os.environ['VM_HOST']
    ip = subprocess.run(['tart', 'ip', WINDOW], capture_output=True, text=True, check=True).stdout.strip()
    return f'admin@{ip}'


def front_window(host):
    """The front app's name and its first window's bounds in VM screen points: x, y, w, h."""
    script = ('const p = Application("System Events").processes.whose({frontmost: true})[0]; '
              'const w = p.windows[0]; JSON.stringify([p.name(), ...w.position(), ...w.size()])')
    out = subprocess.run(['ssh', '-o', 'BatchMode=yes', host, f"osascript -l JavaScript -e '{script}'"],
                         capture_output=True, text=True, check=True).stdout
    app, *bounds = json.loads(out)
    return app, bounds


def beat_states(look, variant):
    """The side-by-side beat's states for one look, from the timeline that the video is rendered from."""
    subprocess.run(['node', 'scripts/check.mjs'], cwd=ROOT, capture_output=True, check=True)
    code = (
        "import { timeline } from './out/timeline.mjs'\n"
        f"const beat = timeline({json.dumps(variant)}).find(b => b.kind === 'side-by-side')\n"
        f"console.log(JSON.stringify({{ length: beat.length, states: beat.states[{json.dumps(look)}] }}))"
    )
    out = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, capture_output=True, text=True,
                         check=True).stdout
    return json.loads(out)


def main():
    look = sys.argv[1]
    variant = sys.argv[2] if len(sys.argv) > 2 else 'draft'
    beat = beat_states(look, variant)
    clicks = [s for s in beat['states'] if s.get('click') or s.get('move')]

    host = vm_host()
    app, bounds = front_window(host)
    print(f'{app} window at {bounds}', flush=True)
    os.makedirs(TAKES, exist_ok=True)
    name = f'side-by-side-{look}'
    movie = os.path.join(TAKES, name + '.mov')
    recorder = subprocess.Popen([RECORDER, WINDOW, movie], stdout=subprocess.PIPE, text=True)
    print(recorder.stdout.readline().strip(), flush=True)
    hand = subprocess.Popen(['ssh', '-o', 'BatchMode=yes', host, 'osascript -l JavaScript hand.js'],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
    log = []

    def send(command):
        sent = time.monotonic()
        hand.stdin.write(command + '\n')
        hand.stdin.flush()
        ack = hand.stdout.readline().strip()
        if not ack.startswith('ok '):
            raise SystemExit(f'drive: {command}: {ack}')
        return sent, time.monotonic()

    try:
        start = time.monotonic() + LEAD
        for s in clicks:
            if s.get('move'):
                x, y = s['move']
                time.sleep(max(0.0, start + s['at'] - time.monotonic()))
                send(f'move {x} {y}')
                continue
            x, y = s['click']
            # The click goes this much early, so its result shows at the state's time.
            due = start + s['at'] - s.get('lead', 0)
            time.sleep(max(0.0, due - HOVER_LEAD - time.monotonic()))
            send(f'move {x} {y}')
            time.sleep(max(0.0, due - time.monotonic()))
            command = f'click {x} {y}'
            sent, acked = send(command)
            log.append({'at': s['at'], 'command': command, 'due': due, 'sent': sent, 'acked': acked})
            print(f"  {s['at']:6.2f} {command}  sent {sent - start:6.2f}, late {1000 * (sent - due):.0f} ms, "
                  f'ack {1000 * (acked - sent):.0f} ms', flush=True)
        time.sleep(max(0.0, start + beat['length'] + TAIL - time.monotonic()))
    finally:
        recorder.send_signal(signal.SIGINT)
        print(recorder.communicate()[0].strip(), flush=True)
        hand.stdin.close()
        hand.wait()

    sidecar = json.load(open(os.path.join(TAKES, name + '.json')))
    first = sidecar['firstFrameHostTime']
    record = {
        'look': look,
        'variant': variant,
        'movie': os.path.basename(movie),
        'app': app,
        # The app window's bounds in VM screen points: x, y, w, h.
        'window': bounds,
        # Seconds into the movie where the beat's first frame falls.
        'beatStartsAt': start - first,
        'presses': [{**p, 'due': p['due'] - first, 'sent': p['sent'] - first, 'acked': p['acked'] - first} for p in log],
    }
    json.dump(record, open(os.path.join(TAKES, name + '.presses.json'), 'w'), indent=1)
    print(f"beat starts {record['beatStartsAt']:.3f} s into {movie}")


main()
