<script lang="ts">
	import { page } from '$app/stores';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import type { ActionResult } from '@sveltejs/kit';
	import { createEventDispatcher } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { superForm } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import { loginSchema } from '../schemas';
	import { Button } from './ui/button';

	export let changeState: ((state: string) => void) | undefined = undefined;
	export let hasMailer: boolean;

	const dispatch = createEventDispatcher<{ result: ActionResult }>();

	let form = superForm({} as any, {
		validators: zodClient(loginSchema),
		onResult: ({ result }) => {
			dispatch('result', result);

			if (result.type === 'failure' && result.data?.message) {
				toast.error(result.data?.message);
			} else if (result.type === 'success' || result.type === 'redirect') {
				toast('Logged in successfully.');
			}
		},
	});

	const { form: formData, enhance } = form;
</script>

<form action="/login{$page.url.search}" class="space-y-3" method="POST" use:enhance>
	<div class="flex flex-col">
		<Form.Field {form} name="username">
			<Form.Control let:attrs>
				<Form.Label>Username</Form.Label>
				<Input {...attrs} autocomplete="username" bind:value={$formData.username} />
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="password">
			<Form.Control let:attrs>
				<Form.Label>Password</Form.Label>
				<Input
					{...attrs}
					autocomplete="current-password"
					bind:value={$formData.password}
					type="password"
				/>
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<div class="flex justify-between">
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

		<Button
			class="h-fit p-0 text-sm"
			href={hasMailer ? `/recover${$page.url.search}` : `/reset${$page.url.search}`}
			on:click={(ev) => {
				if (changeState && typeof changeState == 'function') {
					ev.preventDefault();
					changeState(hasMailer ? 'recover' : 'reset');
				}
			}}
			variant="link"
		>
			Recover access
		</Button>
	</div>

	<Form.Button class="w-full">Login</Form.Button>
</form>
