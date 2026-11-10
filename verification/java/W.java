import java.io.*;
import java.nio.ByteBuffer;
import java.nio.file.*;
import java.util.*;
import org.apache.cassandra.io.sstable.CQLSSTableWriter;
import org.apache.cassandra.utils.ByteBufferUtil;

/* Запись строк data_points настоящим кодом Cassandra 5.0.9.
 * args: outDir, schemaFile, rowsFile, format(big|bti)
 * rows: now_ms \t timestamp_us \t 10 значений (N = null, U = unset, иначе hex) */
public class W {
    static ByteBuffer hex(String s) {
        byte[] b = new byte[s.length() / 2];
        for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
        return ByteBuffer.wrap(b);
    }
    public static void main(String[] a) throws Exception {
        String schema = new String(Files.readAllBytes(Paths.get(a[1])), "UTF-8");
        String insert = "INSERT INTO \"TSDB\".data_points (partition_id, event_time, added_time, annotation, double_value, float_value, long_value, quality_mark, quality_mark_statenumber, string_value) VALUES (?,?,?,?,?,?,?,?,?,?) USING TIMESTAMP ?";
        CQLSSTableWriter.Builder b = CQLSSTableWriter.builder().inDirectory(a[0]).forTable(schema).using(insert).withBufferSizeInMiB(4096);
        if ("bti".equals(a[3])) b = b.withFormat(new org.apache.cassandra.io.sstable.format.bti.BtiFormat.BtiFormatFactory().getInstance(Collections.emptyMap()));
        CQLSSTableWriter w = b.build();
        long n = 0;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(a[2]), "UTF-8"))) {
            String line;
            while ((line = r.readLine()) != null) {
                String[] f = line.split("\t", -1);
                FixedClock.ms = Long.parseLong(f[0]);
                List<ByteBuffer> vals = new ArrayList<>(11);
                for (int i = 2; i < 12; i++) {
                    String v = f[i];
                    vals.add(v.equals("N") ? null : v.equals("U") ? ByteBufferUtil.UNSET_BYTE_BUFFER : hex(v));
                }
                vals.add(ByteBufferUtil.bytes(Long.parseLong(f[1])));
                w.rawAddRow(vals);
                n++;
            }
        }
        w.close();
        System.out.println("rows " + n);
    }
}
