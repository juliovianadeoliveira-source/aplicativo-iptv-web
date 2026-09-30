import com.aurora.browser.BrowserPolicy;
import java.util.List;
public class BrowserPolicyTest {
  private static void check(boolean value){if(!value)throw new AssertionError("Policy check failed");}
  public static void main(String[] args){
    for(String url:new String[]{"javascript:alert(1)","file:///etc/passwd","data:text/html,test","intent://test"}){check(!BrowserPolicy.safeUrl(url));try{BrowserPolicy.destination(url,false,"web");throw new AssertionError("Unsafe URL accepted");}catch(IllegalArgumentException expected){}}
    check(BrowserPolicy.destination("example.com/path",false,"web").equals("https://example.com/path"));
    check(BrowserPolicy.tracker("ads.doubleclick.net",List.of("doubleclick.net")));
    check(!BrowserPolicy.tracker("doubleclick.net.example.org",List.of("doubleclick.net")));
    check(!BrowserPolicy.tracker("notdoubleclick.net",List.of("doubleclick.net")));
    check(BrowserPolicy.search("a & b",false,"images").contains("q=a+%26+b"));
    System.out.println("Android browser policy checks passed");
  }
}
