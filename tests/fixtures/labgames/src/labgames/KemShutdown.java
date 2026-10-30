package labgames;
import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;
import javax.microedition.rms.RecordStore;
/** Only persists the next counter in destroyApp: catches fake graceful shutdown. */
public class KemShutdown extends MIDlet {
 private int n;
 protected void startApp() {
  try { RecordStore s=RecordStore.openRecordStore("shutdown",true);n=s.getNumRecords()>0?s.getRecord(1)[0]&255:0;s.closeRecordStore(); } catch(Exception e){throw new RuntimeException(e.toString());}
  System.out.println("SHUTDOWN_COUNT "+n);
  Display.getDisplay(this).setCurrent(new Canvas(){protected void paint(Graphics g){g.setColor(0x22aa44);g.fillRect(0,0,getWidth(),getHeight());}});
 }
 protected void pauseApp(){}
 protected void destroyApp(boolean unconditional) {
  if ("true".equals(getAppProperty("KemShutdown-Hang"))) { while (true) { try {Thread.sleep(1000);}catch(Exception ignored){} } }
  try {RecordStore s=RecordStore.openRecordStore("shutdown",true);byte[] b={(byte)(n+1)};if(s.getNumRecords()==0)s.addRecord(b,0,1);else s.setRecord(1,b,0,1);s.closeRecordStore();System.out.println("SHUTDOWN_SAVED "+(n+1));}catch(Exception e){throw new RuntimeException(e.toString());}
 }
}
