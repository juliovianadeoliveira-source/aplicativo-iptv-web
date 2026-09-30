package com.aurora.browser;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
public final class BrowserPolicy {
  public static boolean safeUrl(String value) {
    try { URI u = new URI(value); return u.getHost() != null && ("https".equalsIgnoreCase(u.getScheme()) || "http".equalsIgnoreCase(u.getScheme())); }
    catch (Exception e) { return false; }
  }
  public static String search(String query, boolean google, String category) {
    String q;
    try { q = URLEncoder.encode(query.trim(), "UTF-8"); } catch (java.io.UnsupportedEncodingException impossible) { throw new IllegalStateException(impossible); }
    if (google) {
      if ("maps".equals(category)) return "https://www.google.com/maps/search/" + q;
      String mode = switch (category) { case "images" -> "isch"; case "videos" -> "vid"; case "news" -> "nws"; default -> ""; };
      return "https://www.google.com/search?q=" + q + (mode.isEmpty() ? "" : "&tbm=" + mode);
    }
    return "https://duckduckgo.com/?q=" + q + "&kl=br-pt" + ("web".equals(category) ? "" : "&ia=" + category + ("maps".equals(category) ? "" : "&iax=" + category));
  }
  public static String destination(String input, boolean google, String category) {
    String value = input.trim();
    if (value.isEmpty()) return null;
    if (value.length() > 4096) throw new IllegalArgumentException("Endereço muito longo.");
    if (value.matches("(?i)^[a-z][a-z0-9+.-]*:.*") && !value.matches("^[\\w.-]+:\\d+(/.*)?$")) {
      if (!safeUrl(value)) throw new IllegalArgumentException("Use um endereço HTTP ou HTTPS.");
      return value;
    }
    if (!value.matches(".*\\s.*") && value.matches("(?i)^(localhost|([a-z0-9-]+\\.)+[a-z0-9-]+)(:\\d+)?(/.*)?$")) return "https://" + value;
    return search(value, google, category);
  }
  public static boolean tracker(String host, List<String> domains) {
    if (host == null) return false;
    String h = host.toLowerCase(Locale.ROOT).replaceAll("\\.$", "");
    for (String d : domains) if (h.equals(d) || h.endsWith("." + d)) return true;
    return false;
  }
}
