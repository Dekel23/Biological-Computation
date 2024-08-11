def generate_table():
    # ANSI escape codes for colors
    RED = '\033[91m'
    GREEN = '\033[92m'
    WHITE = '\033[0m'

    # Generate combinations for 2 activators and 2 inhibitors
    combinations = []
    for i in range(3):
        for j in range(3):
            combinations.append((j, i))
    
    # Initialize the table
    table = [[0 for _ in range(len(combinations))] for _ in range(18)]
    
    # Define helper functions for regulation conditions
    def all_activators(on):
        return on == 2

    def no_activators(on):
        return on == 0

    def all_repressors(off):
        return off == 2

    def no_repressors(off):
        return off == 0

    # Define all the 18 regulation conditions presents in the provided article
    regulation_conditions = [
        lambda on, off: all_activators(on) and no_repressors(off),
        lambda on, off: not no_activators(on) and no_repressors(off),
        lambda on, off: all_activators(on) and not all_repressors(off),
        lambda on, off: (no_repressors(off) and not no_activators(on)) or (not all_repressors(off) and all_activators(on)),
        lambda on, off: all_activators(on),
        lambda on, off: all_activators(on) or (no_repressors(off) and not no_activators(on)),
        lambda on, off: not no_activators(on) and not all_repressors(off),
        lambda on, off: (not no_activators(on) and not all_repressors(off)) or all_activators(on),
        lambda on, off: not no_activators(on),
        lambda on, off: no_repressors(off),
        lambda on, off: no_repressors(off) or (not all_repressors(off) and all_activators(on)),
        lambda on, off: no_repressors(off) or (not no_activators(on) and not all_repressors(off)),
        lambda on, off: not all_repressors(off),
        lambda on, off: no_repressors(off) or all_activators(on),
        lambda on, off: (no_repressors(off) or all_activators(on)) or (not all_repressors(off) and not no_activators(on)),
        lambda on, off: not all_repressors(off) or all_activators(on),
        lambda on, off: no_repressors(off) or not no_activators(on),
        lambda on, off: not all_repressors(off) or not no_activators(on),
    ]

    # Generate the table
    for i, condition in enumerate(regulation_conditions):
        for j, (on, off) in enumerate(combinations):
            table[i][j] = int(condition(on, off))
    
    # Check for columns that are all 1's or all 0's
    column_status = []
    for j in range(len(combinations)):
        column = [row[j] for row in table]
        # If all 1's print in green
        if all(val == 1 for val in column):
            column_status.append(GREEN)
        # If all 0's print in red
        elif all(val == 0 for val in column):
            column_status.append(RED)
        # Else print in 
        else:
            column_status.append(WHITE)
    
    # Print the table with highlighted columns
    print("Regulation Condition Table (#activators, #inhibitors)")
    print("", *[f"{color}{str(combi)[1:-1]}{WHITE}" for color, combi in zip(column_status, combinations)], sep="\t")
    for i, row in enumerate(table):
        print(f"R{i}", end="\t")
        print(*[f"{color}{val}{WHITE}" for color, val in zip(column_status, row)], sep="\t")

if __name__ == "__main__":
    # Generate and print table for 2 presented activators and 2 presented inhibitors
    generate_table()