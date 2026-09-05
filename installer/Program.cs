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

            string? zipPath = null;
            string? temporaryExtractDir = null;
            try
            {
                string exeDir = Path.GetDirectoryName(Environment.GetCommandLineArgs()[0]);
                string cachePath = Path.Combine(exeDir, "clipper-v5.2.0.zip");
                bool useCache = false;
                if (File.Exists(cachePath))
                {
                    var fileInfo = new FileInfo(cachePath);
                    if ((DateTime.Now - fileInfo.LastWriteTime).TotalHours < 24)
                    {
                        useCache = true;
                        zipPath = cachePath;
                    }
                }

                if (!useCache)
                {
                    // Download to a temporary zip file
                    string tempZip = Path.Combine(Path.GetTempPath(), "clipper-installer-" + Guid.NewGuid().ToString("N") + ".zip");
                    using var client = new HttpClient();
                    client.DefaultRequestHeaders.UserAgent.ParseAdd("ClipperInstaller/5.2");
                    status.Text = "Downloading Clipper 5.2...";
                    await using (var input = await client.GetStreamAsync(ReleaseArchive))
                    await using (var output = File.Create(tempZip))
                        await input.CopyToAsync(output);
                    // Copy to cache for future use
                    File.Copy(tempZip, cachePath, true);
                    zipPath = tempZip;
                }
                else
                {
                    status.Text = "Using cached installer data...";
                }

                // Extract the zip to a temporary directory
                temporaryExtractDir = Path.Combine(Path.GetTempPath(), "clipper-installer-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(temporaryExtractDir);
                status.Text = "Preparing the installer...";
                ZipFile.ExtractToDirectory(zipPath, temporaryExtractDir);
                var root = Directory.GetDirectories(temporaryExtractDir)
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
                // Clean up temporary extraction directory
                if (temporaryExtractDir is not null && Directory.Exists(temporaryExtractDir))
                {
                    try { Directory.Delete(temporaryExtractDir, recursive: true); }
                    catch { /* Ignore errors on cleanup */ }
                }
                // Note: we do not delete the cached zip file here; it persists for future runs.
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
