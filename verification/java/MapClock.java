import java.io.RandomAccessFile;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;

// Часы сервера, управляемые загрузчиком через отображаемый в память файл:
// [0] время сервера, мс; [8] реальное время установки, мс. Пока [0] = 0, часы идут обычным ходом
// за 15 минут до начала окна (fastclock.t0).
public class MapClock implements org.apache.cassandra.utils.Clock {
    static final long T0 = Long.getLong("fastclock.t0", System.currentTimeMillis());
    static final long START = System.currentTimeMillis();
    static MappedByteBuffer buf;
    static {
        try {
            RandomAccessFile f = new RandomAccessFile(System.getProperty("mapclock.file", "/tmp/mapclock"), "rw");
            f.setLength(16);
            buf = f.getChannel().map(FileChannel.MapMode.READ_WRITE, 0, 16);
        } catch (Exception e) { throw new RuntimeException(e); }
    }
    public long nanoTime() { return System.nanoTime(); }
    public long currentTimeMillis() {
        long real = System.currentTimeMillis();
        long base = buf.getLong(0), set = buf.getLong(8);
        if (base == 0) return T0 - 900_000L + (real - START);
        return base + (real - set);
    }
}
