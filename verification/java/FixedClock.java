// Управляемые часы для проверки: local deletion time tombstone и момент истечения TTL берутся из времени записи строки.
public class FixedClock implements org.apache.cassandra.utils.Clock {
    public static volatile long ms = System.currentTimeMillis();
    public long nanoTime() { return System.nanoTime(); }
    public long currentTimeMillis() { return ms; }
}
