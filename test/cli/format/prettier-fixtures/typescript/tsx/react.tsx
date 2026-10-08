const MyCoolList = ({ things }) =>
    <ul>
        {things.map(MyCoolThing)}
    </ul>;

const MyCoolThing = ({ thingo }) => <li>{thingo}</li>;
