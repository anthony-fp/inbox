"""Sends hand commands into the VM during a long take, and logs each on the recorder's clock.

    python3 record/act.py <take> <command> [<command> ...]
    python3 record/act.py <take> --mark <name>          logs a named moment, such as the end of a turn

Each command is one hand.js command, such as "key b" or "type Rename chargeCard". The log is
takes/<take>.acts.jsonl, one line per command, with the host time hand.js acknowledged it, which is
within a few milliseconds of the input event. Start the recorder for <take> separately and stop it
with SIGINT.
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TAKES = os.path.join(os.path.dirname(HERE), 'takes')


def vm_host():
    if os.environ.get('VM_HOST'):
        return os.environ['VM_HOST']
    ip = subprocess.run(['tart', 'ip', 'inbox-ui'], capture_output=True, text=True, check=True).stdout.strip()
    return f'admin@{ip}'


def main():
    take, *commands = sys.argv[1:]
    log = open(os.path.join(TAKES, take + '.acts.jsonl'), 'a')
    if commands[:1] == ['--mark']:
        log.write(json.dumps({'mark': commands[1], 'at': time.monotonic()}) + '\n')
        return
    hand = subprocess.Popen(['ssh', '-o', 'BatchMode=yes', vm_host(), 'osascript -l JavaScript hand.js'],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
    for command in commands:
        hand.stdin.write(command + '\n')
        hand.stdin.flush()
        ack = hand.stdout.readline().strip()
        at = time.monotonic()
        if not ack.startswith('ok '):
            sys.exit(f'act: {command}: {ack}')
        log.write(json.dumps({'command': command, 'at': at}) + '\n')
        log.flush()
        print(f'{command}')
        if command.startswith(('key ctrl+', 'key cmd+')):
            time.sleep(0.25)
    hand.stdin.close()
    hand.wait()


main()
