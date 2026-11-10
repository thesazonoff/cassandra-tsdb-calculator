import com.datastax.driver.core.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/* Загрузка строк в запущенный сервер с темпом ускоренных часов.
 * args: rowsFile, ddl, goFile, t0ms, speed
 * rows: wus \t 12 значений (key, event_time, 8 колонок...): N = null, U = unset, иначе hex */
public class L {
    static java.nio.MappedByteBuffer clk;
    static ByteBuffer hex(String s) { byte[] b = new byte[s.length() / 2]; for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16); return ByteBuffer.wrap(b); }
    public static void main(String[] a) throws Exception {
        long t0 = Long.parseLong(a[3]); double speed = Double.parseDouble(a[4]);
        Cluster c = Cluster.builder().addContactPoint("127.0.0.1").withProtocolVersion(ProtocolVersion.V4).build();
        Session s = c.connect();
        s.execute("CREATE KEYSPACE IF NOT EXISTS \"TSDB\" WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}");
        s.execute("DROP TABLE IF EXISTS \"TSDB\".data_points");
        s.execute(new String(Files.readAllBytes(Paths.get(a[1])), "UTF-8"));
        String[] cols = {"partition_id", "event_time", "added_time", "annotation", "double_value", "float_value", "long_value", "quality_mark", "quality_mark_statenumber", "string_value"};
        PreparedStatement ps = s.prepare("INSERT INTO \"TSDB\".data_points (" + String.join(",", cols) + ") VALUES (?,?,?,?,?,?,?,?,?,?) USING TIMESTAMP ?");
        List<String[]> rows = new ArrayList<>();
        try (BufferedReader r = new BufferedReader(new FileReader(a[0]))) { String l; while ((l = r.readLine()) != null) rows.add(l.split("\t", -1)); }
        try (java.io.RandomAccessFile rf = new java.io.RandomAccessFile(a[2], "rw")) { rf.setLength(16); clk = rf.getChannel().map(java.nio.channels.FileChannel.MapMode.READ_WRITE, 0, 16); }
        long maxLag = 0;
        for (String[] f : rows) {
            long wus = Long.parseLong(f[0]);
            clk.putLong(8, System.currentTimeMillis());
            clk.putLong(0, wus / 1000);               // «сейчас» сервера = время записи строки
            BoundStatement b = ps.bind();
            for (int i = 0; i < 10; i++) {
                String v = f[1 + i];
                if (v.equals("U")) continue;
                if (v.equals("N")) b.setToNull(i); else b.setBytesUnsafe(i, hex(v));
            }
            b.setLong(10, wus);
            s.execute(b);                              // синхронно: следующая строка после подтверждения
        }
        System.out.println("rows " + rows.size() + " max lag ms " + maxLag);
        c.close();
    }
    static class MoreExecutorsHolder { static Executor direct() { return Runnable::run; } }
}
