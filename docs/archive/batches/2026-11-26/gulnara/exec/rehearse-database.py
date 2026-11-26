#!/usr/bin/env python3
"""Start a private local mongod for typed rehearsal; never connect to production."""
import argparse,os,secrets,socket,subprocess,tempfile,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--bson',type=Path,required=True);p.add_argument('--receipt',type=Path,required=True);args=p.parse_args()
here=Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='gulnara-mongo-rehearsal-') as tmp:
 root=Path(tmp).resolve();(root/'db').mkdir();(root/'work').mkdir()
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 proc=subprocess.Popen(['mongod','--dbpath',str(root/'db'),'--bind_ip','127.0.0.1','--port',str(port),'--logpath',str(root/'mongod.log'),'--quiet'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  for _ in range(100):
   if proc.poll() is not None:raise RuntimeError((root/'mongod.log').read_text())
   try:
    with socket.create_connection(('127.0.0.1',port),timeout=.1):break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('Temporary MongoDB not ready')
  env=dict(os.environ,GULNARA_REHEARSAL_URI=f'mongodb://127.0.0.1:{port}/komondor-gulnara-rehearsal-{secrets.token_hex(4)}',GULNARA_REHEARSAL_WORK=str(root/'work'),GULNARA_REHEARSAL_BSON=str(args.bson.resolve()))
  r=subprocess.run(['node',str(here/'rehearse-database.cjs')],env=env,capture_output=True,text=True,timeout=180)
  with args.receipt.open('x') as out:out.write(r.stdout)
  if r.returncode:raise RuntimeError(r.stderr)
  print(r.stdout)
 finally:
  proc.terminate()
  try:proc.wait(timeout=15)
  except subprocess.TimeoutExpired:proc.kill();proc.wait()
