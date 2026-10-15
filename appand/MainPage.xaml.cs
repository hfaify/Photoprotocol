namespace PhotoprotocolViewer;

public partial class MainPage : ContentPage
{
    private readonly WebView _viewerWebView;
    private bool _isPageLoaded = false;

    public MainPage()
    {
        BackgroundColor = Color.FromArgb("#121212");

        _viewerWebView = new WebView
        {
            HorizontalOptions = LayoutOptions.Fill,
            VerticalOptions = LayoutOptions.Fill,
            Source = "index.html"
        };

        // Перехватываем команду нативного открытия файла из JavaScript
        _viewerWebView.Navigating += async (s, e) =>
        {
            if (e.Url.StartsWith("native://pickfile"))
            {
                e.Cancel = true; // Отменяем переход по ссылке в браузере
                await PickFileNativeAsync();
            }
        };

        _viewerWebView.Navigated += (s, e) =>
        {
            _isPageLoaded = true;
            SendPendingImage();
        };

        App.OnImageReceived += () =>
        {
            MainThread.BeginInvokeOnMainThread(() =>
            {
                if (_isPageLoaded)
                {
                    SendPendingImage();
                }
            });
        };

        Content = _viewerWebView;
    }

    private async Task PickFileNativeAsync()
    {
        try
        {
            var options = new PickOptions
            {
                PickerTitle = "Выберите изображение",
                FileTypes = FilePickerFileType.Images
            };

            var result = await FilePicker.Default.PickAsync(options);
            if (result != null)
            {
                using var stream = await result.OpenReadAsync();
                using var memoryStream = new MemoryStream();
                await stream.CopyToAsync(memoryStream);
                var bytes = memoryStream.ToArray();
                var b64 = Convert.ToBase64String(bytes);

                await _viewerWebView.EvaluateJavaScriptAsync($"window.loadImageFromBase64('{b64}');");
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ERR] PickFile failed: {ex.Message}");
        }
    }

    private async void SendPendingImage()
    {
        if (!string.IsNullOrEmpty(App.PendingImageBase64))
        {
            var b64 = App.PendingImageBase64;
            App.PendingImageBase64 = null;

            await _viewerWebView.EvaluateJavaScriptAsync($"window.loadImageFromBase64('{b64}');");
        }
    }
}