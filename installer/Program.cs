using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http;

namespace ClipperInstaller;

internal static class Program
{
    private const string ReleaseArchive =
        "https://github.com/kebab1337420/vencord-clipper/archive/refs/tags/v5.2.0.zip";

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new InstallerForm());
    }

    private sealed class InstallerForm : Form
    {
        private readonly CheckBox steamVr = new()
        {
            AutoSize = true,
            Text = "Install SteamVR integration",
            Checked = false,
            Location = new Point(24, 112)
        };

        private readonly Label status = new()
        {
            AutoSize = false,
            Location = new Point(24, 150),
            Size = new Size(430, 48),
            Text = "Ready to install Clipper 5.2.",
            ForeColor = Color.DimGray
        };

        private readonly Button install = new()
        {
            Text = "Install",
            Location = new Point(326, 208),
            Size = new Size(128, 36)
        };

        public InstallerForm()
        {
            Text = "Clipper installer";
            ClientSize = new Size(478, 270);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;

            Controls.Add(new Label
            {
                AutoSize = false,
                Location = new Point(24, 22),
                Size = new Size(430, 54),
                Text = "Install Vencord + Clipper 5.2",
                Font = new Font(Font.FontFamily, 18, FontStyle.Bold)
            });
            Controls.Add(new Label
            {
                AutoSize = false,
                Location = new Point(24, 78),
                Size = new Size(430, 26),
                Text = "The bundle is downloaded from the official GitHub release."
            });
            Controls.Add(steamVr);
            Controls.Add(status);
            Controls.Add(install);
            install.Click += async (_, _) => await InstallAsync();
        }

        private async Task InstallAsync()
        {
            install.Enabled = false;
            steamVr.Enabled = false;

            string? temporary = null;
            try
            {
                temporary = Path.Combine(Path.GetTempPath(), "clipper-installer-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(temporary);
                var archive = Path.Combine(temporary, "clipper.zip");

                status.Text = "Downloading Clipper 5.2...";
                using var client = new HttpClient();
                client.DefaultRequestHeaders.UserAgent.ParseAdd("ClipperInstaller/5.2");
                await using (var input = await client.GetStreamAsync(ReleaseArchive))
                await using (var output = File.Create(archive))
                    await input.CopyToAsync(output);

                status.Text = "Preparing the installer...";
                ZipFile.ExtractToDirectory(archive, temporary);
                var root = Directory.GetDirectories(temporary)
                    .FirstOrDefault(path => File.Exists(Path.Combine(path, "install.bat")));
                if (root is null) throw new InvalidOperationException("The release archive is missing install.bat.");

                await RunBatchAsync(Path.Combine(root, "install.bat"), root);

                if (steamVr.Checked)
                {
                    status.Text = "Installing SteamVR integration...";
                    await RunBatchAsync(Path.Combine(root, "VRinstaller.bat"), root);
                }

                status.Text = steamVr.Checked
                    ? "Clipper and SteamVR integration installed. Restart Discord."
                    : "Clipper installed. Restart Discord.";
                MessageBox.Show(this, status.Text, "Clipper", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception error)
            {
                status.Text = "Installation failed.";
                MessageBox.Show(this, error.Message, "Clipper installation failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                install.Enabled = true;
                steamVr.Enabled = true;
                if (temporary is not null)
                {
                    try { Directory.Delete(temporary, recursive: true); }
                    catch { /* The installer completed; locked files can be removed later. */ }
                }
            }
        }

        private static async Task RunBatchAsync(string file, string workingDirectory)
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/d /c \"\"{file}\"\"",
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            }) ?? throw new InvalidOperationException("Could not start the installer.");

            var output = await process.StandardOutput.ReadToEndAsync();
            var error = await process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            if (process.ExitCode != 0)
                throw new InvalidOperationException(string.IsNullOrWhiteSpace(error) ? output : error);
        }
    }
}
