import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  type BrowserSignerHandle,
  createBrowserSigner,
  unlockBrowserSigner,
} from "@/features/micasa/browser-signer-vault";
import type { MiCasaNostrSigner } from "@/features/micasa/realtime";
import {
  enrollMiCasaSigner,
  loadMiCasaSigner,
  type MiCasaSignerSnapshot,
} from "@/features/micasa/signer";
import { Button } from "@/shared/ui/button";

function Card({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      {children}
    </section>
  );
}
function Loading() {
  return (
    <Card>
      <div className="py-10 text-center">
        <LoaderCircle
          aria-hidden="true"
          className="mx-auto h-7 w-7 animate-spin text-slate-600"
        />
        <p className="mt-3 text-sm text-slate-600">
          Checking this device&apos;s signer…
        </p>
      </div>
    </Card>
  );
}
function Failed({ message, retry }: { message: string; retry: () => void }) {
  return (
    <Card>
      <div className="mx-auto max-w-xl py-8 text-center">
        <ShieldAlert
          aria-hidden="true"
          className="mx-auto h-9 w-9 text-amber-700"
        />
        <h2 className="mt-4 text-xl font-semibold text-slate-950">
          Messages are locked on this device
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
        <Button className="mt-5" onClick={retry} variant="outline">
          <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
          Check again
        </Button>
      </div>
    </Card>
  );
}

function Enrollment({
  snapshot,
  onReady,
}: {
  snapshot: MiCasaSignerSnapshot & { state: "ENROLLMENT_REQUIRED" };
  onReady: (signer: BrowserSignerHandle) => void;
}) {
  const queryClient = useQueryClient();
  const [deviceLabel, setDeviceLabel] = useState("This browser");
  const [pendingSigner, setPendingSigner] =
    useState<BrowserSignerHandle | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const signer =
        pendingSigner ?? (await createBrowserSigner(snapshot.bindingId));
      setPendingSigner(signer);
      const result = await enrollMiCasaSigner(snapshot, deviceLabel, signer);
      return { result, signer };
    },
    onSuccess: ({ result, signer }) => {
      queryClient.setQueryData(["micasa", "signer"], result.readback);
      onReady(signer);
    },
  });

  return (
    <Card>
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
          <KeyRound aria-hidden="true" className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-slate-950">
            Secure messaging on this device
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            MiCasa will create this account&apos;s Nostr signing key in your
            browser, encrypt it with a non-extractable device key, and send
            Personal-Agent only a signed public-key proof. No browser extension
            or raw-key setup is required.
          </p>
          <label className="mt-5 block max-w-md text-sm font-medium text-slate-700">
            Device name
            <input
              className="mt-2 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-600"
              maxLength={80}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setDeviceLabel(event.target.value)
              }
              value={deviceLabel}
            />
          </label>
          {mutation.isError && (
            <p
              className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
              role="alert"
            >
              {mutation.error.message} The existing local identity was preserved
              for safe reconciliation.
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              className="bg-slate-950 text-white hover:bg-slate-800"
              disabled={mutation.isPending || deviceLabel.trim().length === 0}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending && (
                <LoaderCircle
                  aria-hidden="true"
                  className="mr-2 h-4 w-4 animate-spin"
                />
              )}
              Secure this device
            </Button>
            <span className="inline-flex items-center text-xs text-slate-500">
              <LockKeyhole aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
              Private key material stays encrypted in this browser
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function MiCasaSignerBoundary({
  children,
  renderUnavailable,
}: {
  children: (signer: MiCasaNostrSigner) => ReactNode;
  renderUnavailable?: (content: ReactNode) => ReactNode;
}) {
  const signerAuthority = useQuery({
    queryKey: ["micasa", "signer"],
    queryFn: loadMiCasaSigner,
    retry: false,
  });
  const [signer, setSigner] = useState<BrowserSignerHandle | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  useEffect(() => {
    if (signerAuthority.data?.state !== "READY" || signer !== null) {
      return;
    }
    let active = true;
    void unlockBrowserSigner(
      signerAuthority.data.bindingId,
      signerAuthority.data.publicKey,
    )
      .then((handle) => {
        if (active) setSigner(handle);
        else handle.lock();
      })
      .catch(() => {
        if (active) {
          setUnlockError(
            "Personal-Agent recognizes this account's signer, but its encrypted key is not available on this device. Recovery or an approved device-addition flow is required; MiCasa will not create a replacement identity.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [signerAuthority.data, signer]);
  useEffect(
    () => () => {
      signer?.lock();
    },
    [signer],
  );

  const unavailable = (content: ReactNode) =>
    renderUnavailable ? renderUnavailable(content) : content;
  if (signerAuthority.isPending) return unavailable(<Loading />);
  if (signerAuthority.isError || !signerAuthority.data) {
    return unavailable(
      <Failed
        message="Personal-Agent could not verify signer authority. No fallback identity was created."
        retry={() => void signerAuthority.refetch()}
      />,
    );
  }
  if (signerAuthority.data.state === "ENROLLMENT_REQUIRED") {
    return unavailable(
      <Enrollment
        onReady={(handle) => {
          setUnlockError(null);
          setSigner(handle);
        }}
        snapshot={signerAuthority.data}
      />,
    );
  }
  if (unlockError) {
    return unavailable(
      <Failed
        message={unlockError}
        retry={() => {
          setUnlockError(null);
          void signerAuthority.refetch();
        }}
      />,
    );
  }
  if (!signer) return unavailable(<Loading />);
  return <>{children(signer)}</>;
}
