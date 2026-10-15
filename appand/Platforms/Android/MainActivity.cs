using Android.App;
using Android.Content;
using Android.Content.PM;
using Android.OS;

namespace PhotoprotocolViewer;

[Activity(
    Theme = "@style/Maui.SplashTheme",
    MainLauncher = true,
    LaunchMode = LaunchMode.SingleTask,
    ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode | ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize | ConfigChanges.Density)]
[IntentFilter(
    new[] { Intent.ActionSend, Intent.ActionView },
    Categories = new[] { Intent.CategoryDefault, Intent.CategoryBrowsable },
    DataMimeType = "image/*")]
public class MainActivity : MauiAppCompatActivity
{
    protected override void OnCreate(Bundle? savedInstanceState)
    {
        base.OnCreate(savedInstanceState);
        ProcessIntent(Intent);
    }

    protected override void OnNewIntent(Intent? intent)
    {
        base.OnNewIntent(intent);
        ProcessIntent(intent);
    }

    private void ProcessIntent(Intent? intent)
    {
        if (intent == null) return;

        Android.Net.Uri? imageUri = null;

#pragma warning disable CA1416, CA1422
        if (Intent.ActionSend.Equals(intent.Action))
        {
            if (Build.VERSION.SdkInt >= BuildVersionCodes.Tiramisu)
            {
                imageUri = intent.GetParcelableExtra(Intent.ExtraStream, Java.Lang.Class.FromType(typeof(Android.Net.Uri))) as Android.Net.Uri;
            }
            else
            {
                imageUri = intent.GetParcelableExtra(Intent.ExtraStream) as Android.Net.Uri;
            }
        }
        else if (Intent.ActionView.Equals(intent.Action))
        {
            imageUri = intent.Data;
        }
#pragma warning restore CA1416, CA1422

        if (imageUri != null)
        {
            try
            {
                using var stream = ContentResolver?.OpenInputStream(imageUri);
                if (stream != null)
                {
                    using var memoryStream = new MemoryStream();
                    stream.CopyTo(memoryStream);
                    var bytes = memoryStream.ToArray();
                    var base64 = Convert.ToBase64String(bytes);

                    App.PendingImageBase64 = base64;
                    App.NotifyImageReceived();
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[ERR] Intent read failed: {ex.Message}");
            }
        }
    }
}