// Ускоренные часы сервера: до появления файла fastclock.go время идёт обычным ходом до начала окна,
// затем идёт со скоростью fastclock.speed. nanoTime не меняется.
public class FastClock implements org.apache.cassandra.utils.Clock {
    static final long T0 = Long.getLong("fastclock.t0", System.currentTimeMillis());
    static final double SPEED = Double.parseDouble(System.getProperty("fastclock.speed", "1000"));
    static final String GO = System.getProperty("fastclock.go", "/tmp/fastclock.go");
    static volatile long anchor = -1;
    static volatile long lastCheck = 0;
    static final long START = System.currentTimeMillis();
    public long nanoTime() { return System.nanoTime(); }
    public long currentTimeMillis() {
        if (anchor < 0) {
            long n = System.nanoTime();
            if (n - lastCheck > 50_000_000L) {
                lastCheck = n;
                java.io.File f = new java.io.File(GO);
                if (f.exists()) try { anchor = Long.parseLong(new String(java.nio.file.Files.readAllBytes(f.toPath())).trim()); } catch (Exception e) { }
            }
            if (anchor < 0) return T0 - 900_000L + (System.currentTimeMillis() - START); // до старта: обычный ход, за 15 мин до окна
        }
        return T0 + (long) ((System.currentTimeMillis() - anchor) * SPEED);
    }
}
