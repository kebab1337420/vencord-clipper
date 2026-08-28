/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the process that actually talks to SteamVR
 *
 * OpenVR is a C API in a DLL, and there is no way to reach one of those from
 * Node without a compiled addon. Shipping a compiled addon means shipping a
 * binary per platform, and a Vencord plugin is source that the person installing
 * it builds themselves - so that was never going to work either.
 *
 * What is already on every Windows machine that could be running SteamVR is a
 * C# compiler, sitting inside PowerShell. So the bridge is a PowerShell script
 * that compiles the C# below on first run and executes it, and the plugin talks
 * to it over its standard input and output, one JSON object per line. No
 * toolchain to install, no binary to trust, and the whole thing is a text file
 * the user can read.
 *
 * The awkward part of OpenVR from a language without a header is that only six
 * functions are exported from the DLL. Everything else is reached through
 * `VR_GetGenericInterface`, which hands back a pointer to a struct of function
 * pointers - so calling one means knowing its index in that struct, counted from
 * the header. Those indices are written down at each call site below, and the
 * whole scheme is checked once at startup by calling `GetRuntimeVersion`, which
 * is the last useful entry in the largest of the tables: if the count is wrong
 * anywhere, that call comes back as nonsense rather than a version number, and
 * the bridge says so instead of carrying on into somebody else's function.
 *
 * The interface versions are pinned on purpose. SteamVR keeps shims for older
 * versions around for ever, so asking for the one this file was written against
 * keeps working as SteamVR moves on, and fails loudly and immediately on a
 * SteamVR too old to have it - which is the correct answer, and much better than
 * silently getting a table laid out differently than expected.
 *
 * Written to C# 4: PowerShell 5.1 compiles with the .NET Framework compiler, and
 * anything newer than that will not build on a stock Windows install.
 */

/*
 * Numbers are printed with the invariant culture everywhere, without exception.
 * A machine set to French formats 1.83 as "1,83", which is not JSON, and the
 * receiving end would see a truncated object on a bug that only appears for some
 * of the people running it.
 */
const CSHARP = `
using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

namespace Clipper
{
    public static class Bridge
    {
        [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Ansi)]
        private static extern IntPtr LoadLibrary(string path);

        [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Ansi)]
        private static extern IntPtr GetProcAddress(IntPtr module, string name);

        // The six flat exports. Everything else lives behind GetGenericInterface.
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr InitInternal(ref int error, int applicationType);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void ShutdownInternal();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr GetGenericInterface([MarshalAs(UnmanagedType.LPStr)] string version, ref int error);

        // IVRSystem
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate void GetPoses(int origin, float secondsAhead, IntPtr poses, uint count);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate uint IndexForRole(int role);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate IntPtr RuntimeVersion();

        // IVRInput
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int SetManifest([MarshalAs(UnmanagedType.LPStr)] string path);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int GetHandle([MarshalAs(UnmanagedType.LPStr)] string name, out ulong handle);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int UpdateState([In] ActiveActionSet[] sets, uint sizeOfOne, uint count);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int DigitalData(ulong action, ref DigitalActionData data, uint size, ulong restrictTo);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int BindingUI([MarshalAs(UnmanagedType.LPStr)] string appKey, ulong actionSet, ulong device, [MarshalAs(UnmanagedType.I1)] bool onDesktop);

        // IVRApplications
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int AddManifest([MarshalAs(UnmanagedType.LPStr)] string path, [MarshalAs(UnmanagedType.I1)] bool temporary);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int Identify(uint pid, [MarshalAs(UnmanagedType.LPStr)] string appKey);

        [StructLayout(LayoutKind.Sequential)]
        private struct ActiveActionSet
        {
            public ulong ActionSet;
            public ulong RestrictedToDevice;
            public ulong SecondaryActionSet;
            public uint Padding;
            public int Priority;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DigitalActionData
        {
            [MarshalAs(UnmanagedType.I1)] public bool Active;
            public ulong ActiveOrigin;
            [MarshalAs(UnmanagedType.I1)] public bool State;
            [MarshalAs(UnmanagedType.I1)] public bool Changed;
            public float UpdateTime;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DevicePose
        {
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 12)] public float[] DeviceToAbsolute;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 3)] public float[] Velocity;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 3)] public float[] AngularVelocity;
            public int TrackingResult;
            [MarshalAs(UnmanagedType.I1)] public bool PoseIsValid;
            [MarshalAs(UnmanagedType.I1)] public bool DeviceIsConnected;
        }

        private const int ApplicationBackground = 3;
        private const int UniverseStanding = 1;
        private const int MaxDevices = 64;
        private const int RoleLeftHand = 1;
        private const int RoleRightHand = 2;

        private static readonly object Gate = new object();
        private static string _command;

        private static T Entry<T>(IntPtr table, int index)
        {
            IntPtr fn = Marshal.ReadIntPtr(table, index * IntPtr.Size);
            if (fn == IntPtr.Zero) throw new EntryPointNotFoundException("Nothing at index " + index + " of an OpenVR function table");

            return (T) (object) Marshal.GetDelegateForFunctionPointer(fn, typeof(T));
        }

        private static string Esc(string text)
        {
            if (text == null) return "";
            return text.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"").Replace("\\r", " ").Replace("\\n", " ");
        }

        private static void Say(string line)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }

        private static void Fail(string message)
        {
            Say("{\\"t\\":\\"error\\",\\"message\\":\\"" + Esc(message) + "\\"}");
        }

        private static string Num(double value)
        {
            return value.ToString("0.###", CultureInfo.InvariantCulture);
        }

        private static double Magnitude(float[] v)
        {
            if (v == null || v.Length < 3) return 0;
            return Math.Sqrt((double) v[0] * v[0] + (double) v[1] * v[1] + (double) v[2] * v[2]);
        }

        // Reads whatever the plugin last asked for, and forgets it.
        private static string TakeCommand()
        {
            lock (Gate)
            {
                string held = _command;
                _command = null;
                return held;
            }
        }

        private static void ReadCommands()
        {
            while (true)
            {
                string line = Console.In.ReadLine();

                // The plugin closed the pipe: it is gone, and so are we. Without
                // this a bridge outlives a client that crashed, holding a
                // SteamVR application registration nothing will ever clear.
                if (line == null) { lock (Gate) { _command = "stop"; } return; }

                line = line.Trim();
                if (line.Length == 0) continue;

                lock (Gate) { _command = line; }
            }
        }

        public static void Run(string apiPath, string actionsPath, string manifestPath, string appKey, string actionList)
        {
            IntPtr library = LoadLibrary(apiPath);
            if (library == IntPtr.Zero) { Fail("openvr_api.dll could not be loaded from " + apiPath); return; }

            IntPtr initAddress = GetProcAddress(library, "VR_InitInternal");
            IntPtr shutdownAddress = GetProcAddress(library, "VR_ShutdownInternal");
            IntPtr interfaceAddress = GetProcAddress(library, "VR_GetGenericInterface");

            if (initAddress == IntPtr.Zero || shutdownAddress == IntPtr.Zero || interfaceAddress == IntPtr.Zero)
            {
                Fail("openvr_api.dll is not the library it claims to be: the entry points are missing");
                return;
            }

            InitInternal init = (InitInternal) Marshal.GetDelegateForFunctionPointer(initAddress, typeof(InitInternal));
            ShutdownInternal shutdown = (ShutdownInternal) Marshal.GetDelegateForFunctionPointer(shutdownAddress, typeof(ShutdownInternal));
            GetGenericInterface get = (GetGenericInterface) Marshal.GetDelegateForFunctionPointer(interfaceAddress, typeof(GetGenericInterface));

            int error = 0;

            /*
             * Background, not Overlay. An overlay application starts SteamVR if
             * it is not already running, and Discord launching SteamVR because a
             * setting is on would be indefensible. Background attaches to a
             * session that exists and fails cleanly when there is none, which is
             * exactly the retry the supervisor is built around.
             */
            init(ref error, ApplicationBackground);
            if (error != 0) { Fail("SteamVR is not running (error " + error + ")"); return; }

            try
            {
                IntPtr system = get("FnTable:IVRSystem_026", ref error);
                if (system == IntPtr.Zero) { Fail("This SteamVR is too old: it has no IVRSystem_026"); return; }

                IntPtr input = get("FnTable:IVRInput_011", ref error);
                if (input == IntPtr.Zero) { Fail("This SteamVR is too old: it has no IVRInput_011"); return; }

                IntPtr apps = get("FnTable:IVRApplications_008", ref error);
                if (apps == IntPtr.Zero) { Fail("This SteamVR is too old: it has no IVRApplications_008"); return; }

                // IVRSystem index 49, GetRuntimeVersion, the last entry but one.
                // Reached correctly only if every index before it was counted
                // right, which is the whole point of asking.
                IntPtr versionPtr = Entry<RuntimeVersion>(system, 49)();
                string version = versionPtr == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(versionPtr);

                if (string.IsNullOrEmpty(version) || version.Length > 64)
                {
                    Fail("The OpenVR function tables are not laid out as expected, refusing to call into them");
                    return;
                }

                // IVRApplications index 0, AddApplicationManifest. Temporary, so
                // nothing is left in SteamVR's application list afterwards.
                Entry<AddManifest>(apps, 0)(manifestPath, true);

                // IVRApplications index 11, IdentifyApplication. This is what
                // makes the binding panel say Clipper rather than powershell.
                Entry<Identify>(apps, 11)((uint) System.Diagnostics.Process.GetCurrentProcess().Id, appKey);

                // IVRInput index 0, SetActionManifestPath.
                int failed = Entry<SetManifest>(input, 0)(actionsPath);
                if (failed != 0) { Fail("SteamVR rejected the action manifest (error " + failed + ")"); return; }

                // IVRInput index 1, GetActionSetHandle; index 2, GetActionHandle.
                GetHandle setHandles = Entry<GetHandle>(input, 1);
                GetHandle actionHandles = Entry<GetHandle>(input, 2);

                // The set, then every action in it, separated by pipes: one
                // argument rather than a variable number of them.
                string[] parts = actionList.Split('|');

                ulong setHandle = 0;
                failed = setHandles(parts[0], out setHandle);
                if (failed != 0) { Fail("SteamVR does not know the action set (error " + failed + ")"); return; }

                string[] names = new string[parts.Length - 1];
                ulong[] actions = new ulong[parts.Length - 1];

                for (int i = 1; i < parts.Length; i++)
                {
                    ulong handle = 0;
                    actionHandles(parts[0] + "/in/" + parts[i], out handle);

                    names[i - 1] = parts[i];
                    actions[i - 1] = handle;
                }

                ActiveActionSet[] active = new ActiveActionSet[1];
                active[0].ActionSet = setHandle;

                UpdateState update = Entry<UpdateState>(input, 4);
                DigitalData digital = Entry<DigitalData>(input, 5);
                BindingUI openBindings = Entry<BindingUI>(input, 32);
                GetPoses poses = Entry<GetPoses>(system, 12);
                IndexForRole role = Entry<IndexForRole>(system, 18);

                uint setSize = (uint) Marshal.SizeOf(typeof(ActiveActionSet));
                uint dataSize = (uint) Marshal.SizeOf(typeof(DigitalActionData));
                int stride = Marshal.SizeOf(typeof(DevicePose));
                IntPtr buffer = Marshal.AllocHGlobal(stride * MaxDevices);

                Thread reader = new Thread(ReadCommands);
                reader.IsBackground = true;
                reader.Start();

                Say("{\\"t\\":\\"ready\\",\\"runtime\\":\\"" + Esc(version) + "\\"}");

                try
                {
                    int tick = 0;

                    while (true)
                    {
                        string command = TakeCommand();

                        if (command == "stop") break;

                        // IVRInput index 32, OpenBindingUI: SteamVR's own binding
                        // panel, opened on our action set. Shown on the desktop as
                        // well as in the headset, because the person who just
                        // clicked the button in Discord is looking at a monitor.
                        if (command == "bindings") openBindings(appKey, setHandle, 0, true);

                        update(active, setSize, 1);

                        for (int i = 0; i < actions.Length; i++)
                        {
                            if (actions[i] == 0) continue;

                            DigitalActionData data = new DigitalActionData();
                            if (digital(actions[i], ref data, dataSize, 0) != 0) continue;

                            // Changed as well as State: held down is one press,
                            // not fifty a second.
                            if (data.Active && data.State && data.Changed)
                            {
                                Say("{\\"t\\":\\"action\\",\\"name\\":\\"" + Esc(names[i]) + "\\"}");
                            }
                        }

                        // Poses ten times a second rather than fifty. Hands do not
                        // change direction meaningfully faster than that, and the
                        // line is being parsed by a browser.
                        if (++tick >= 5)
                        {
                            tick = 0;
                            poses(UniverseStanding, 0f, buffer, MaxDevices);

                            DevicePose head = (DevicePose) Marshal.PtrToStructure(buffer, typeof(DevicePose));
                            double hands = 0;

                            uint left = role(RoleLeftHand);
                            uint right = role(RoleRightHand);

                            if (left < MaxDevices) hands = Math.Max(hands, HandSpeed(buffer, stride, left));
                            if (right < MaxDevices) hands = Math.Max(hands, HandSpeed(buffer, stride, right));

                            double turn = head.PoseIsValid ? Magnitude(head.AngularVelocity) : 0;

                            Say("{\\"t\\":\\"motion\\",\\"hands\\":" + Num(hands) + ",\\"head\\":" + Num(turn) + "}");
                        }

                        Thread.Sleep(20);
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            finally
            {
                shutdown();
            }
        }

        private static double HandSpeed(IntPtr buffer, int stride, uint index)
        {
            DevicePose pose = (DevicePose) Marshal.PtrToStructure(new IntPtr(buffer.ToInt64() + (long) stride * index), typeof(DevicePose));
            return pose.PoseIsValid ? Magnitude(pose.Velocity) : 0;
        }
    }
}
`;

/**
 * The script that compiles the above and runs it.
 *
 * Everything variable arrives as a parameter, so the file itself is the same on
 * every machine and can be read by anybody who wants to know what Discord just
 * started.
 */
export const SCRIPT = `# Vencord Clipper - SteamVR bridge. Generated; edits are overwritten.
param(
    [Parameter(Mandatory = $true)][string] $Api,
    [Parameter(Mandatory = $true)][string] $Actions,
    [Parameter(Mandatory = $true)][string] $Manifest,
    [Parameter(Mandatory = $true)][string] $AppKey,
    [Parameter(Mandatory = $true)][string] $ActionList
)

$ErrorActionPreference = "Stop"

$source = @'
${CSHARP}
'@

try {
    Add-Type -TypeDefinition $source -Language CSharp
} catch {
    Write-Output ('{"t":"error","message":"The bridge could not be compiled: ' + ($_.Exception.Message -replace '["\\\\]', ' ' -replace '\\s+', ' ') + '"}')
    exit 1
}

[Clipper.Bridge]::Run($Api, $Actions, $Manifest, $AppKey, $ActionList)
`;
