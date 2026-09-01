import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	LoaderCircle,
	MessageCircle,
	RefreshCw,
	Send,
	ShieldAlert,
} from "lucide-react";
import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";
import {
	type MiCasaNostrSigner,
	MiCasaRealtimeClient,
	type SignedNostrEvent,
} from "@/features/micasa/realtime";
import { Button } from "@/shared/ui/button";

function authorLabel(event: SignedNostrEvent, viewerPublicKey: string) {
	return event.pubkey === viewerPublicKey
		? "You"
		: "Signed participant " + event.pubkey.slice(0, 8);
}
function timestamp(createdAt: number) {
	return new Date(createdAt * 1_000).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
}

export function MiCasaRoomTimeline({
	roomId,
	roomName,
	signer,
}: {
	roomId: string;
	roomName: string;
	signer: MiCasaNostrSigner;
}) {
	const queryClient = useQueryClient();
	const [message, setMessage] = useState("");
	const [publishStatus, setPublishStatus] = useState<
		"IDLE" | "QUEUED" | "PUBLISHED" | "FAILED"
	>("IDLE");
	const client = useMemo(
		() =>
			new MiCasaRealtimeClient({
				browserOrigin: window.location.origin,
				gatewayPath: "/api/micasa/v1/realtime",
				signer,
			}),
		[signer],
	);
	const publicKey = useQuery({
		queryKey: ["micasa", "signer-public-key"],
		queryFn: () => signer.getPublicKey(),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const history = useQuery({
		queryKey: ["micasa", "room-history", roomId],
		queryFn: () => client.queryChannelHistory(roomId, 100),
		retry: false,
	});
	const publish = useMutation({
		mutationFn: (content: string) =>
			client.publishChannelMessage(roomId, content),
		onMutate: () => setPublishStatus("QUEUED"),
		onSuccess: (event) => {
			queryClient.setQueryData<SignedNostrEvent[]>(
				["micasa", "room-history", roomId],
				(current = []) =>
					[...current.filter((item) => item.id !== event.id), event].sort(
						(left, right) =>
							left.created_at - right.created_at ||
							left.id.localeCompare(right.id),
					),
			);
			setMessage("");
			setPublishStatus("PUBLISHED");
		},
		onError: () => setPublishStatus("FAILED"),
	});

	if (history.isPending || publicKey.isPending) {
		return (
			<section className="rounded-3xl border border-slate-200 bg-white py-16 text-center">
				<LoaderCircle
					aria-hidden="true"
					className="mx-auto h-7 w-7 animate-spin text-slate-600"
				/>
				<p className="mt-3 text-sm text-slate-600">
					Authenticating and loading signed room history…
				</p>
			</section>
		);
	}
	if (history.isError || publicKey.isError || !publicKey.data) {
		return (
			<section className="rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center">
				<ShieldAlert
					aria-hidden="true"
					className="mx-auto h-9 w-9 text-amber-700"
				/>
				<h2 className="mt-4 text-xl font-semibold text-slate-950">
					Signed room history is unavailable
				</h2>
				<p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
					The PA-authorized Nostr gateway did not complete authentication and
					room readback. MiCasa did not substitute cached or demo messages.
				</p>
				<Button
					className="mt-5"
					onClick={() => void history.refetch()}
					variant="outline"
				>
					<RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
					Retry room
				</Button>
			</section>
		);
	}

	const events = history.data ?? [];
	const viewerPublicKey = publicKey.data;
	return (
		<section
			aria-label={roomName + " signed messages"}
			className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
		>
			<header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
				<div className="flex items-center gap-3">
					<MessageCircle
						aria-hidden="true"
						className="h-5 w-5 text-slate-600"
					/>
					<div>
						<h2 className="font-semibold text-slate-950">Signed messages</h2>
						<p className="text-xs text-slate-500">
							PA-authorized room · NIP-42 authenticated
						</p>
					</div>
				</div>
				<Button
					onClick={() => void history.refetch()}
					size="sm"
					variant="outline"
				>
					<RefreshCw aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
					Refresh
				</Button>
			</header>

			<div
				aria-live="polite"
				className="max-h-[32rem] min-h-64 space-y-4 overflow-y-auto p-5"
			>
				{events.length === 0 ? (
					<div className="py-16 text-center">
						<p className="font-medium text-slate-800">No signed messages yet</p>
						<p className="mt-2 text-sm text-slate-500">
							Send the first real message to this room.
						</p>
					</div>
				) : (
					events.map((event) => {
						const mine = event.pubkey === viewerPublicKey;
						return (
							<article
								className={mine ? "ml-auto max-w-[85%]" : "max-w-[85%]"}
								key={event.id}
							>
								<div
									className={
										mine
											? "rounded-2xl rounded-br-md bg-slate-950 px-4 py-3 text-white"
											: "rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-slate-900"
									}
								>
									<p className="whitespace-pre-wrap break-words text-sm leading-6">
										{event.content}
									</p>
								</div>
								<p
									className={
										mine
											? "mt-1 text-right text-xs text-slate-400"
											: "mt-1 text-xs text-slate-400"
									}
								>
									{authorLabel(event, viewerPublicKey)} ·{" "}
									{timestamp(event.created_at)}
								</p>
							</article>
						);
					})
				)}
			</div>

			<div className="border-t border-slate-200 p-4">
				<label className="sr-only" htmlFor="micasa-message">
					Message {roomName}
				</label>
				<textarea
					className="min-h-24 w-full resize-none rounded-2xl border border-slate-300 p-3 text-sm outline-none focus:border-slate-600"
					id="micasa-message"
					maxLength={32_768}
					onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
						setMessage(event.target.value);
						if (publishStatus !== "QUEUED") setPublishStatus("IDLE");
					}}
					placeholder={"Message " + roomName}
					value={message}
				/>
				<div className="mt-3 flex flex-wrap items-center justify-between gap-3">
					<div className="text-xs text-slate-500" role="status">
						{publishStatus === "QUEUED" && "Signing and publishing…"}
						{publishStatus === "PUBLISHED" && (
							<span className="inline-flex items-center text-emerald-700">
								<CheckCircle2
									aria-hidden="true"
									className="mr-1.5 h-3.5 w-3.5"
								/>
								Published to Buzz/Nostr
							</span>
						)}
						{publishStatus === "FAILED" &&
							"Publish failed. The message was not marked delivered."}
						{publishStatus === "IDLE" &&
							"Delivery acknowledgement is shown only when supported."}
					</div>
					<Button
						className="bg-slate-950 text-white hover:bg-slate-800"
						disabled={publish.isPending || message.trim().length === 0}
						onClick={() => publish.mutate(message)}
					>
						{publish.isPending ? (
							<LoaderCircle
								aria-hidden="true"
								className="mr-2 h-4 w-4 animate-spin"
							/>
						) : (
							<Send aria-hidden="true" className="mr-2 h-4 w-4" />
						)}
						Send signed message
					</Button>
				</div>
				{publish.isError && (
					<p
						className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
						role="alert"
					>
						{publish.error.message}
					</p>
				)}
			</div>
		</section>
	);
}
