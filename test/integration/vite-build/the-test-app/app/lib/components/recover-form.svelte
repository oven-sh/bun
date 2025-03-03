<script lang="ts">
	import { page } from '$app/stores';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import type { ActionResult } from '@sveltejs/kit';
	import { createEventDispatcher } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { superForm } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import { recoverSchema } from '../schemas';
	import { Button } from './ui/button';

	export let changeState: ((state: string) => void) | undefined = undefined;
	export let hasMailer: boolean;

	const dispatch = createEventDispatcher<{ result: ActionResult }>();

	let form = superForm({} as any, {
		validators: zodClient(recoverSchema),
		onResult: ({ result }) => {
			dispatch('result', result);

			if (result.type === 'failure' && result.data?.message) {
				toast.error(result.data?.message);
			} else if (result.type === 'success' || result.type === 'redirect') {
				toast.info('An email with a recovery code will be sent if the user is found.');
			}
		},
	});

	const { form: formData, enhance } = form;
</script>

<form action="/recover{$page.url.search}" class="flex flex-col space-y-3" method="POST" use:enhance>
	{#if hasMailer}
		<div class="flex flex-col">
			<Form.Field {form} name="username">
				<Form.Control let:attrs>
					<Form.Label>Username</Form.Label>
					<Input {...attrs} bind:value={$formData.username} />
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>
	{:else}
		<p class="rounded border border-primary p-4 text-center text-sm">
			The site can't send emails.<br />Make a request to the admin for a recovery code.
		</p>
	{/if}

	<div class="flex justify-between">
		<Button
			class="h-fit p-0 text-sm"
			href="/login{$page.url.search}"
			on:click={(ev) => {
				if (changeState && typeof changeState == 'function') {
					ev.preventDefault();
					changeState('login');
				}
			}}
			variant="link"
		>
			Login
		</Button>

		<Button
			class="h-fit p-0 text-sm"
			href="/register{$page.url.search}"
			on:click={(ev) => {
				if (changeState && typeof changeState == 'function') {
					ev.preventDefault();
					changeState('register');
				}
			}}
			variant="link"
		>
			Create an account
		</Button>
	</div>

	<Form.Button class="w-full" disabled={!hasMailer}>Recover</Form.Button>

	<Button
		class="mx-auto"
		href="/reset{$page.url.search}"
		on:click={(ev) => {
			if (changeState && typeof changeState == 'function') {
				ev.preventDefault();
				changeState('reset');
			}
		}}
		variant="link"
	>
		I already have a recovery code
	</Button>
</form>
