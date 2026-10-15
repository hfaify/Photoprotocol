namespace PhotoprotocolViewer;

public partial class App : Application
{
    public static string? PendingImageBase64 { get; set; }
    public static event Action? OnImageReceived;

    public App()
    {
        InitializeComponent();
    }

    protected override Window CreateWindow(IActivationState? activationState)
    {
        return new Window(new MainPage());
    }

    public static void NotifyImageReceived()
    {
        OnImageReceived?.Invoke();
    }
}