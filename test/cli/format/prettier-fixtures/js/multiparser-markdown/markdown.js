export default function ReadMe() {
    return md`
        ## Why Prettier?
        
        ### Building and enforcing a style guide
        
        By far the biggest reason for adopting Prettier is to stop all the on-going debates over styles. It is generally accepted that having a common style guide is valuable for a project and team but getting there is a very painful and unrewarding process. People get very emotional around particular ways of writing code and nobody likes spending time writing and receiving nits.
        - “We want to free mental threads and end discussions around style. While sometimes fruitful, these discussions are for the most part wasteful.”
        - “Literally had an engineer go through a huge effort of cleaning up all of our code because we were debating ternary style for the longest time and were inconsistent about it. It was dumb, but it was a weird on-going "great debate" that wasted lots of little back and forth bits. It's far easier for us all to agree now: just run Prettier, and go with that style.”
        - “Getting tired telling people how to style their product code.”
        - “Our top reason was to stop wasting our time debating style nits.”
        - “Having a githook set up has reduced the amount of style issues in PRs that result in broken builds due to ESLint rules or things I have to nit-pick or clean up later.”
        - “I don't want anybody to nitpick any other person ever again.”
        - “It reminds me of how Steve Jobs used to wear the same clothes every day because he has a million decisions to make and he didn't want to be bothered to make trivial ones like picking out clothes. I think Prettier is like that.”
    `;
}
